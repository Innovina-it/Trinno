"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { getSessionToken, requireUser } from "@/lib/auth";
import { profiles, userNotificationPrefs } from "@/lib/db/schema";
import { StructuredError } from "@/lib/errors";
import { hasExternalDeliveryChannel } from "@/lib/notifications/channels/availability";
import { z } from "zod";

const SetPrefInput = z.object({
  // kind is intentionally free-form (max 64); reserved kinds like
  // "digest.daily" pass through unchanged.
  kind: z.string().min(1).max(64),
  channel: z.enum(["in_app", "email", "push", "telegram"]),
  enabled: z.boolean(),
});

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function listNotificationPrefs(): Promise<
  { kind: string; channel: string; enabled: boolean }[]
> {
  await requireUser();
  const t = (await getSessionToken())!;
  return dbAsUser(t, async (tx) =>
    tx
      .select({
        kind: userNotificationPrefs.kind,
        channel: userNotificationPrefs.channel,
        enabled: userNotificationPrefs.enabled,
      })
      .from(userNotificationPrefs),
  );
}

export async function setNotificationPref(
  input: z.infer<typeof SetPrefInput>,
) {
  const p = SetPrefInput.parse(input);
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  await dbAsUser(t, async (tx) => {
    await tx
      .insert(userNotificationPrefs)
      .values({
        userId,
        kind: p.kind,
        channel: p.channel,
        enabled: p.enabled,
      })
      .onConflictDoUpdate({
        target: [
          userNotificationPrefs.userId,
          userNotificationPrefs.kind,
          userNotificationPrefs.channel,
        ],
        set: { enabled: p.enabled },
      });
  });
  revalidatePath("/settings/notifications");
}

/**
 * Daily email digest opt-in.  Stored on profiles.email_digest_optin
 * (migration 0090) — global flag, separate from the per-(kind, channel)
 * rows in user_notification_prefs.  The cron at /api/notifications/digest
 * reads only profiles where this is TRUE.
 */
export async function getEmailDigestPref(): Promise<boolean> {
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  return dbAsUser(t, async (tx) => {
    const [row] = await tx
      .select({ optin: profiles.emailDigestOptin })
      .from(profiles)
      .where(eq(profiles.id, userId));
    return row?.optin ?? false;
  });
}

export async function setEmailDigestPref(enabled: boolean) {
  z.boolean().parse(enabled);
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  await dbAsUser(t, async (tx) => {
    await tx
      .update(profiles)
      .set({ emailDigestOptin: enabled })
      .where(eq(profiles.id, userId));
  });
  revalidatePath("/settings/notifications");
}

/**
 * "Notify me on every event" master toggle.  Stored on
 * profiles.notify_per_event (migration 0126) — a global flag that gates
 * per-event delivery on EXTERNAL channels (email + telegram). The in-app
 * bell/inbox is always-on and unaffected; the daily digest is separate
 * (profiles.email_digest_optin). See
 * docs/features/telegram-channel/U6-MASTER-TOGGLE-CONTRACT.md.
 */
export async function getNotifyPerEvent(): Promise<boolean> {
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  return dbAsUser(t, async (tx) => {
    const [row] = await tx
      .select({ value: profiles.notifyPerEvent })
      .from(profiles)
      .where(eq(profiles.id, userId));
    return row?.value ?? false;
  });
}

export async function setNotifyPerEvent(enabled: boolean): Promise<void> {
  z.boolean().parse(enabled);
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  // Server-side guard is the real enforcement — the client disabled-state is
  // UX only. Refuse enabling the master toggle while no external channel can
  // actually deliver to this user.
  if (enabled && !(await hasExternalDeliveryChannel(userId))) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "No delivery channel connected",
    );
  }
  await dbAsUser(t, async (tx) => {
    await tx
      .update(profiles)
      .set({ notifyPerEvent: enabled })
      .where(eq(profiles.id, userId));
  });
  revalidatePath("/settings/notifications");
}

export async function deleteNotificationPref(kind: string, channel: string) {
  await requireUser();
  const t = (await getSessionToken())!;
  const userId = decodeSub(t);
  await dbAsUser(t, async (tx) => {
    await tx
      .delete(userNotificationPrefs)
      .where(
        and(
          eq(userNotificationPrefs.userId, userId),
          eq(userNotificationPrefs.kind, kind),
          eq(userNotificationPrefs.channel, channel),
        ),
      );
  });
  revalidatePath("/settings/notifications");
}
