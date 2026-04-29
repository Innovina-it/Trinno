"use server";
import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import {
  CreateCardInput, UpdateCardInput, MoveCardInput, ArchiveCardInput,
} from "@/lib/validation";

export async function createCardImpl(token: string, input: { listId: string; title: string }) {
  const parsed = CreateCardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [last] = await tx.select({ position: cards.position }).from(cards)
      .where(eq(cards.listId, parsed.listId))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(cards).values({
      listId: parsed.listId,
      title: parsed.title,
      position: pos,
      boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateCardImpl(token: string, input: {
  id: string;
  title?: string;
  description?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean;
}) {
  const parsed = UpdateCardInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (parsed.title !== undefined) patch.title = parsed.title;
  if (parsed.description !== undefined) patch.description = parsed.description;
  if (parsed.dueDate !== undefined) {
    patch.dueDate =
      parsed.dueDate === null
        ? null
        : parsed.dueDate instanceof Date
          ? parsed.dueDate
          : new Date(parsed.dueDate);
  }
  if (parsed.dueComplete !== undefined) patch.dueComplete = parsed.dueComplete;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(cards).set(patch)
      .where(eq(cards.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function moveCardImpl(token: string, input: {
  id: string; listId: string; position: string;
}) {
  const parsed = MoveCardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(cards)
      .set({ listId: parsed.listId, position: parsed.position })
      .where(eq(cards.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function archiveCardImpl(token: string, input: { id: string; archived: boolean }) {
  const parsed = ArchiveCardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(cards).set({ archived: parsed.archived })
      .where(eq(cards.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function createCard(input: { listId: string; title: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createCardImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function updateCard(input: Parameters<typeof updateCardImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateCardImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function moveCard(input: Parameters<typeof moveCardImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveCardImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function archiveCard(input: { id: string; archived: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await archiveCardImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
