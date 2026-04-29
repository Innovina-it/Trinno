"use server";
import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { checklists, checklistItems } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import {
  CreateChecklistInput, RenameChecklistInput, DeleteChecklistInput,
  AddChecklistItemInput, ToggleChecklistItemInput, RemoveChecklistItemInput,
} from "@/lib/validation";

export async function createChecklistImpl(token: string, input: { cardId: string; title: string }) {
  const parsed = CreateChecklistInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [last] = await tx.select({ position: checklists.position }).from(checklists)
      .where(eq(checklists.cardId, parsed.cardId))
      .orderBy(desc(checklists.position)).limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(checklists).values({
      cardId: parsed.cardId, title: parsed.title, position: pos,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function renameChecklistImpl(token: string, input: { id: string; title: string }) {
  const parsed = RenameChecklistInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(checklists).set({ title: parsed.title })
      .where(eq(checklists.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteChecklistImpl(token: string, input: { id: string }) {
  const parsed = DeleteChecklistInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(checklists).where(eq(checklists.id, parsed.id))
      .returning({ id: checklists.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function addChecklistItemImpl(token: string, input: { checklistId: string; text: string }) {
  const parsed = AddChecklistItemInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [last] = await tx.select({ position: checklistItems.position }).from(checklistItems)
      .where(eq(checklistItems.checklistId, parsed.checklistId))
      .orderBy(desc(checklistItems.position)).limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(checklistItems).values({
      checklistId: parsed.checklistId, text: parsed.text, position: pos,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function toggleChecklistItemImpl(token: string, input: { id: string; completed: boolean }) {
  const parsed = ToggleChecklistItemInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(checklistItems).set({ completed: parsed.completed })
      .where(eq(checklistItems.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function removeChecklistItemImpl(token: string, input: { id: string }) {
  const parsed = RemoveChecklistItemInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(checklistItems).where(eq(checklistItems.id, parsed.id))
      .returning({ id: checklistItems.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function createChecklist(input: Parameters<typeof createChecklistImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createChecklistImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function renameChecklist(input: Parameters<typeof renameChecklistImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await renameChecklistImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteChecklist(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteChecklistImpl(t, input);
}
export async function addChecklistItem(input: Parameters<typeof addChecklistItemImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await addChecklistItemImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function toggleChecklistItem(input: { id: string; completed: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await toggleChecklistItemImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function removeChecklistItem(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await removeChecklistItemImpl(t, input);
}
