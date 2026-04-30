"use server";
import { revalidatePath } from "next/cache";
import { eq, isNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { MarkNotificationReadInput } from "@/lib/validation";

export async function markNotificationReadImpl(
  token: string,
  input: { id: string; read: boolean },
) {
  const p = MarkNotificationReadInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(notifications)
      .set({ readAt: p.read ? new Date() : null })
      .where(eq(notifications.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function markAllReadImpl(token: string) {
  return dbAsUser(token, async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(isNull(notifications.readAt));
  });
}

export async function markNotificationRead(input: { id: string; read: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await markNotificationReadImpl(t, input);
  revalidatePath("/inbox");
  return r;
}

export async function markAllRead() {
  await requireUser();
  const t = (await getSessionToken())!;
  await markAllReadImpl(t);
  revalidatePath("/inbox");
}
