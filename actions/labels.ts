"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { labels, cardLabels } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateLabelInput, RenameLabelInput, DeleteLabelInput, ToggleCardLabelInput,
} from "@/lib/validation";

export async function createLabelImpl(token: string, input: { boardId: string; name: string; color: string }) {
  const parsed = CreateLabelInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(labels).values({
      boardId: parsed.boardId, name: parsed.name, color: parsed.color,
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function renameLabelImpl(token: string, input: { id: string; name: string; color: string }) {
  const parsed = RenameLabelInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(labels)
      .set({ name: parsed.name, color: parsed.color })
      .where(eq(labels.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteLabelImpl(token: string, input: { id: string }) {
  const parsed = DeleteLabelInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(labels).where(eq(labels.id, parsed.id))
      .returning({ id: labels.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function toggleCardLabelImpl(token: string, input: { cardId: string; labelId: string }) {
  const parsed = ToggleCardLabelInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const existing = await tx.select().from(cardLabels).where(and(
      eq(cardLabels.cardId, parsed.cardId),
      eq(cardLabels.labelId, parsed.labelId),
    ));
    if (existing.length > 0) {
      await tx.delete(cardLabels).where(and(
        eq(cardLabels.cardId, parsed.cardId),
        eq(cardLabels.labelId, parsed.labelId),
      ));
      return { attached: false };
    }
    // boardId set by trigger
    const [row] = await tx.insert(cardLabels).values({
      cardId: parsed.cardId, labelId: parsed.labelId,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    return { attached: true };
  });
}

export async function createLabel(input: Parameters<typeof createLabelImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createLabelImpl(t, input);
  revalidatePath(`/b/${input.boardId}`);
  return r;
}
export async function renameLabel(input: Parameters<typeof renameLabelImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await renameLabelImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteLabel(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteLabelImpl(t, input);
}
export async function toggleCardLabel(input: { cardId: string; labelId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  return toggleCardLabelImpl(t, input);
}
