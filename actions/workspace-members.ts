"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteMemberInput, ChangeMemberRoleInput, RemoveMemberInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

export async function inviteMemberImpl(
  token: string,
  input: { workspaceId: string; email: string; role: "admin" | "member" },
) {
  const parsed = InviteMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${parsed.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId)
      throw new StructuredError(
        "VALIDATION_ERROR",
        "No user with that email",
        { kind: "user-not-found" },
      );

    const [row] = await tx.insert(workspaceMembers)
      .values({ workspaceId: parsed.workspaceId, userId, role: parsed.role })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const existing = await tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, userId),
      ));
      if (existing.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
      return existing[0];
    }
    return row;
  });
}

export async function changeMemberRoleImpl(
  token: string,
  input: { workspaceId: string; userId: string; role: "owner" | "admin" | "member" },
) {
  const parsed = ChangeMemberRoleInput.parse(input);
  return dbAsUser(token, async (tx) => {
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
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, parsed.workspaceId),
      eq(workspaceMembers.userId, parsed.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
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

export async function inviteMember(input: Parameters<typeof inviteMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteMemberImpl(token, input);
  revalidateWorkspace(input.workspaceId);
  return r;
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
