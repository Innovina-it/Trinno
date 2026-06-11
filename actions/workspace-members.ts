"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq, isNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers, workspaceInvitations, workspaces, profiles } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteMemberInput, InviteMemberByUserIdInput, ChangeMemberRoleInput, RemoveMemberInput, ResendInvitationInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import { sendInviteEmail } from "@/lib/invite-email";
import { listMembers } from "@/lib/queries/workspaces";

type MemberTx = Parameters<Parameters<typeof dbAsUser>[1]>[0];

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

async function assertCanManageWorkspaceMembers(
  tx: MemberTx,
  workspaceId: string,
  userId: string,
) {
  const [membership] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new StructuredError(
      "ROLE_INSUFFICIENT",
      "Only workspace owners and admins can manage members.",
    );
  }
}

// Success shape returned by the *Impl functions (they throw on failure).
export type InviteResult = { kind: "added" | "invited"; userId: string };

// What the exported actions return to the client. Expected, user-fixable
// failures (rate limit, already invited, …) are RETURNED rather than thrown:
// Next.js redacts thrown Server Action messages in production (digest only),
// so a thrown message never reaches the UI.
export type InviteActionResult =
  | InviteResult
  | { kind: "error"; code: string; message: string };

export async function inviteMemberImpl(
  token: string,
  input: { workspaceId: string; email: string; role: "admin" | "member" | "guest" },
): Promise<InviteResult> {
  const parsed = InviteMemberInput.parse(input);
  const email = parsed.email.toLowerCase();
  const actorId = decodeSub(token);

  // 1. Authorize + detect whether the email already has an account (RLS tx),
  //    and guard against a duplicate pending invite at the same time.
  const existingUserId = await dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);

    // Duplicate-invite guard runs regardless of whether the email resolves to
    // an existing user (an unconfirmed invited user is still "existing" in
    // auth.users, so we must check invitations before the user lookup).
    const [dup] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ))
      .limit(1);
    if (dup) {
      throw new StructuredError("ALREADY_INVITED", "An invite is already pending for this email.");
    }

    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${email}) as id`,
    );
    return (lookup as unknown as { id: string | null }[])[0]?.id ?? null;
  });

  // 2a. Existing user. If they're UNCONFIRMED (a prior invitee who was revoked
  // or never set a password), direct-adding would strand them as a member who
  // can't sign in — re-issue the invite instead. Confirmed users are added
  // directly (prior behavior).
  if (existingUserId) {
    const sb = getServiceSupabase();
    const { data: existing } = await sb.auth.admin.getUserById(existingUserId);
    const unconfirmed = !!existing?.user && !existing.user.email_confirmed_at;

    if (unconfirmed) {
      const { workspaceName, inviterName } = await dbAsUser(token, async (tx) => {
        await tx
          .insert(workspaceInvitations)
          .values({
            workspaceId: parsed.workspaceId,
            email,
            role: parsed.role,
            invitedBy: actorId,
            userId: existingUserId,
            status: "pending",
          })
          .onConflictDoNothing();
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: parsed.workspaceId, userId: existingUserId, role: parsed.role })
          .onConflictDoNothing();
        const [ws] = await tx
          .select({ name: workspaces.name })
          .from(workspaces)
          .where(eq(workspaces.id, parsed.workspaceId))
          .limit(1);
        const [actor] = await tx
          .select({ name: profiles.displayName })
          .from(profiles)
          .where(eq(profiles.id, actorId))
          .limit(1);
        return { workspaceName: ws?.name ?? "your workspace", inviterName: actor?.name };
      });
      await sendInviteEmail(email, workspaceName, inviterName, parsed.workspaceId);
      return { kind: "invited", userId: existingUserId };
    }

    await dbAsUser(token, async (tx) => {
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: parsed.workspaceId, userId: existingUserId, role: parsed.role })
        .onConflictDoNothing();
    });
    return { kind: "added", userId: existingUserId };
  }

  // 2b. New email → create the pending invitation BEFORE inviting (the
  // before-user-created hook reads it for the domain carve-out), and capture
  // the workspace + inviter names to personalize the invite email template.
  const { workspaceName, inviterName } = await dbAsUser(token, async (tx) => {
    await tx.insert(workspaceInvitations).values({
      workspaceId: parsed.workspaceId,
      email,
      role: parsed.role,
      invitedBy: actorId,
      status: "pending",
    });
    const [ws] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, parsed.workspaceId))
      .limit(1);
    const [actor] = await tx
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, actorId))
      .limit(1);
    return { workspaceName: ws?.name ?? "your workspace", inviterName: actor?.name };
  });

  // 3. Native Supabase invite: creates the unconfirmed user AND emails the link
  //    via the customized invite template (supabase/templates/invite.html).
  //    inviter_name / workspace_name flow into the template as {{ .Data.* }} so
  //    the email names the inviter + workspace and showcases the product. The
  //    re-invite/resend paths (2a, resendInvitationImpl) deliver the same
  //    content via Resend (lib/invite-email.ts) since inviteUserByEmail can't
  //    re-send to an already-created unconfirmed user.
  const sb = getServiceSupabase();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/accept-invite`;
  try {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { inviter_name: inviterName ?? "", workspace_name: workspaceName },
    });

    if (error || !data?.user) {
      // Race: the email got registered between step 1 and now → fall back to direct add.
      // Prefer the stable error code; fall back to the message for resilience.
      const code = (error as { code?: string } | null)?.code;
      const alreadyRegistered =
        code === "email_exists" ||
        code === "user_already_exists" ||
        !!error?.message?.toLowerCase().includes("already");
      if (alreadyRegistered) {
        const retryId = await dbAsUser(token, async (tx) => {
          const r = await tx.execute(sql`select public.find_user_id_by_email(${email}) as id`);
          return (r as unknown as { id: string | null }[])[0]?.id ?? null;
        });
        if (retryId) {
          await dbAsUser(token, async (tx) => {
            await tx
              .update(workspaceInvitations)
              .set({ status: "revoked" })
              .where(and(
                eq(workspaceInvitations.workspaceId, parsed.workspaceId),
                eq(workspaceInvitations.email, email),
                eq(workspaceInvitations.status, "pending"),
              ));
            await tx
              .insert(workspaceMembers)
              .values({ workspaceId: parsed.workspaceId, userId: retryId, role: parsed.role })
              .onConflictDoNothing();
          });
          return { kind: "added", userId: retryId };
        }
      }
      // Supabase Auth caps how many invite emails go out per hour
      // (config.toml [auth.rate_limit] email_sent). Surface a clear,
      // user-facing reason instead of the raw GoTrue string.
      if (/rate limit/i.test(error?.message ?? "")) {
        throw new StructuredError(
          "INVITE_RATE_LIMITED",
          "Invite limit reached. Please try again later.",
        );
      }
      throw new StructuredError("INVITE_FAILED", error?.message ?? "Failed to send invitation");
    }

    const newUserId = data.user.id;
    await dbAsUser(token, async (tx) => {
      await tx
        .update(workspaceInvitations)
        // Stamp the initial invite-email send time. This path delivers via
        // Supabase SMTP (not Resend), so it is logged but NOT rate-limited.
        .set({ userId: newUserId, inviteEmailSentAt: new Date() })
        .where(and(
          eq(workspaceInvitations.workspaceId, parsed.workspaceId),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, "pending"),
        ));
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: parsed.workspaceId, userId: newUserId, role: parsed.role })
        .onConflictDoNothing();
    });
    return { kind: "invited", userId: newUserId };
  } catch (e) {
    // Roll back the bypass-granting invitation so it cannot linger.
    // Best-effort: a cleanup failure must not mask the original error.
    try {
      await dbAsUser(token, async (tx) => {
        await tx.delete(workspaceInvitations).where(and(
          eq(workspaceInvitations.workspaceId, parsed.workspaceId),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, "pending"),
          isNull(workspaceInvitations.userId),
        ));
      });
    } catch {
      // swallow — surface the original failure below
    }
    throw StructuredError.fromUnknown(e, "INVITE_FAILED");
  }
}

// Invite a person picked from the suggestion dropdown. We only have their
// profile id client-side (auth.users.email is RLS-hidden), so authorize the
// caller first, resolve the target email via service-role, then delegate to
// the battle-tested email path so every branch (confirmed/unconfirmed/dup)
// behaves identically to a typed-email invite.
export async function inviteMemberByUserIdImpl(
  token: string,
  input: { workspaceId: string; userId: string; role: "admin" | "member" | "guest" },
): Promise<InviteResult> {
  const parsed = InviteMemberByUserIdInput.parse(input);
  const actorId = decodeSub(token);

  // Authorize BEFORE touching the service-role email lookup, otherwise a
  // non-admin could probe arbitrary users' emails by id.
  await dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
  });

  const sb = getServiceSupabase();
  const { data, error } = await sb.auth.admin.getUserById(parsed.userId);
  const email = data?.user?.email;
  if (error || !email) {
    throw new StructuredError("NOT_FOUND", "That person no longer has an account.");
  }

  return inviteMemberImpl(token, {
    workspaceId: parsed.workspaceId,
    email,
    role: parsed.role,
  });
}

export async function resendInvitationImpl(
  token: string,
  input: { workspaceId: string; email: string },
): Promise<void> {
  const parsed = ResendInvitationInput.parse(input);
  const email = parsed.email.toLowerCase();
  const actorId = decodeSub(token);

  const { workspaceName, inviterName } = await dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const [inv] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ))
      .limit(1);
    if (!inv) {
      throw new StructuredError("NOT_FOUND", "No pending invitation for that email.");
    }
    const [ws] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, parsed.workspaceId))
      .limit(1);
    const [actor] = await tx
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, actorId))
      .limit(1);
    return { workspaceName: ws?.name ?? "your workspace", inviterName: actor?.name };
  });

  await sendInviteEmail(email, workspaceName, inviterName, parsed.workspaceId);
}

export async function resendInvitation(input: Parameters<typeof resendInvitationImpl>[1]): Promise<void> {
  await requireUser();
  const token = (await getSessionToken())!;
  await resendInvitationImpl(token, input);
}

export async function changeMemberRoleImpl(
  token: string,
  input: { workspaceId: string; userId: string; role: "owner" | "admin" | "member" | "guest" },
) {
  const parsed = ChangeMemberRoleInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const [row] = await tx.update(workspaceMembers)
      .set({ role: parsed.role })
      .where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeMemberImpl(
  token: string,
  input: { workspaceId: string; userId: string },
) {
  const parsed = RemoveMemberInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const r = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, parsed.workspaceId),
      eq(workspaceMembers.userId, parsed.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    // If this member was a not-yet-accepted invitee, revoke the invitation so
    // the domain-gate bypass evaporates.
    await tx.update(workspaceInvitations)
      .set({ status: "revoked" })
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.userId, parsed.userId),
        eq(workspaceInvitations.status, "pending"),
      ));
  });
}

// Workspace roster changes affect every page that hosts the
// WorkspaceStoreProvider: /w/<id>/*, /b/<bid>/* (board layout loads the
// workspace snapshot too), and /dashboards/<did>. Revalidate broadly so
// the fresh `workspaceProfiles` flows into the store on next render.
// Realtime CDC (subscribed inside WorkspaceStoreProvider) handles
// already-open tabs.
function revalidateWorkspace(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}`, "layout");
  revalidatePath("/b", "layout");
  revalidatePath("/dashboards", "layout");
}

export async function inviteMember(input: Parameters<typeof inviteMemberImpl>[1]): Promise<InviteActionResult> {
  await requireUser();
  const token = (await getSessionToken())!;
  try {
    const r = await inviteMemberImpl(token, input);
    revalidateWorkspace(input.workspaceId);
    return r;
  } catch (e) {
    if (e instanceof StructuredError) {
      return { kind: "error", code: e.code, message: e.message };
    }
    throw e;
  }
}
export async function inviteMemberByUserId(
  input: Parameters<typeof inviteMemberByUserIdImpl>[1],
): Promise<InviteActionResult> {
  await requireUser();
  const token = (await getSessionToken())!;
  try {
    const r = await inviteMemberByUserIdImpl(token, input);
    revalidateWorkspace(input.workspaceId);
    return r;
  } catch (e) {
    if (e instanceof StructuredError) {
      return { kind: "error", code: e.code, message: e.message };
    }
    throw e;
  }
}
export async function changeMemberRole(input: Parameters<typeof changeMemberRoleImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await changeMemberRoleImpl(token, input);
  revalidateWorkspace(input.workspaceId);
  return r;
}
export async function removeMember(input: Parameters<typeof removeMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  await removeMemberImpl(token, input);
  revalidateWorkspace(input.workspaceId);
}

// Read-only fetch used by the members panel to patch itself on realtime
// events instead of refreshing the whole route. RLS scopes the result:
// a viewer who lost workspace access gets an empty list back.
export async function fetchWorkspaceMembers(input: { workspaceId: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  return listMembers(token, input.workspaceId);
}
