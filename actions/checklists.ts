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
import { StructuredError } from "@/lib/errors";
import {
  assertNotGuest,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

async function getCardIdForChecklist(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  checklistId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ cardId: checklists.cardId })
    .from(checklists)
    .where(eq(checklists.id, checklistId))
    .limit(1);
  return row?.cardId ?? null;
}

async function getCardIdForChecklistItem(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  itemId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ cardId: checklists.cardId })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(eq(checklistItems.id, itemId))
    .limit(1);
  return row?.cardId ?? null;
}

export async function createChecklistImpl(token: string, input: { cardId: string; title: string }) {
  const parsed = CreateChecklistInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.cardId, actorId));
    const [last] = await tx.select({ position: checklists.position }).from(checklists)
      .where(eq(checklists.cardId, parsed.cardId))
      .orderBy(desc(checklists.position)).limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(checklists).values({
      cardId: parsed.cardId, title: parsed.title, position: pos,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function renameChecklistImpl(token: string, input: { id: string; title: string }) {
  const parsed = RenameChecklistInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const cardId = await getCardIdForChecklist(tx, parsed.id);
    if (cardId) assertNotGuest(await getWorkspaceRoleForCard(tx, cardId, actorId));
    const [row] = await tx.update(checklists).set({ title: parsed.title })
      .where(eq(checklists.id, parsed.id)).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function deleteChecklistImpl(token: string, input: { id: string }) {
  const parsed = DeleteChecklistInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const cardId = await getCardIdForChecklist(tx, parsed.id);
    if (cardId) assertNotGuest(await getWorkspaceRoleForCard(tx, cardId, actorId));
    const r = await tx.delete(checklists).where(eq(checklists.id, parsed.id))
      .returning({ id: checklists.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

export async function addChecklistItemImpl(token: string, input: { checklistId: string; text: string }) {
  const parsed = AddChecklistItemInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const cardId = await getCardIdForChecklist(tx, parsed.checklistId);
    if (cardId) assertNotGuest(await getWorkspaceRoleForCard(tx, cardId, actorId));
    const [last] = await tx.select({ position: checklistItems.position }).from(checklistItems)
      .where(eq(checklistItems.checklistId, parsed.checklistId))
      .orderBy(desc(checklistItems.position)).limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(checklistItems).values({
      checklistId: parsed.checklistId, text: parsed.text, position: pos,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function toggleChecklistItemImpl(token: string, input: { id: string; completed: boolean }) {
  const parsed = ToggleChecklistItemInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const cardId = await getCardIdForChecklistItem(tx, parsed.id);
    if (cardId) assertNotGuest(await getWorkspaceRoleForCard(tx, cardId, actorId));
    const [row] = await tx.update(checklistItems).set({ completed: parsed.completed })
      .where(eq(checklistItems.id, parsed.id)).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeChecklistItemImpl(token: string, input: { id: string }) {
  const parsed = RemoveChecklistItemInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const cardId = await getCardIdForChecklistItem(tx, parsed.id);
    if (cardId) assertNotGuest(await getWorkspaceRoleForCard(tx, cardId, actorId));
    const r = await tx.delete(checklistItems).where(eq(checklistItems.id, parsed.id))
      .returning({ id: checklistItems.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
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
