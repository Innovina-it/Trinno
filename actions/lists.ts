"use server";
import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import {
  CreateListInput, RenameListInput, MoveListInput, ArchiveListInput,
} from "@/lib/validation";

export async function createListImpl(token: string, input: { boardId: string; title: string }) {
  const parsed = CreateListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [last] = await tx.select({ position: lists.position }).from(lists)
      .where(eq(lists.boardId, parsed.boardId))
      .orderBy(desc(lists.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx.insert(lists)
      .values({ boardId: parsed.boardId, title: parsed.title, position: pos })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function renameListImpl(token: string, input: { id: string; title: string }) {
  const parsed = RenameListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(lists).set({ title: parsed.title })
      .where(eq(lists.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function moveListImpl(token: string, input: { id: string; position: string }) {
  const parsed = MoveListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(lists).set({ position: parsed.position })
      .where(eq(lists.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function archiveListImpl(token: string, input: { id: string; archived: boolean }) {
  const parsed = ArchiveListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(lists).set({ archived: parsed.archived })
      .where(eq(lists.id, parsed.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function createList(input: { boardId: string; title: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createListImpl(t, input);
  revalidatePath(`/b/${input.boardId}`);
  return r;
}
export async function renameList(input: { id: string; title: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await renameListImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function moveList(input: { id: string; position: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveListImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function archiveList(input: { id: string; archived: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await archiveListImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
