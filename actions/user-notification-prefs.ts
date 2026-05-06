"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { getSessionToken, requireUser } from "@/lib/auth";
import { userNotificationPrefs } from "@/lib/db/schema";
import { z } from "zod";

const SetPrefInput = z.object({
  kind: z.string().min(1).max(64),
  channel: z.enum(["in_app", "email", "push"]),
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
