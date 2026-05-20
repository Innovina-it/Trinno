"use server";
import { revalidatePath } from "next/cache";
import { eq, desc, and, sql, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { dbAsUser } from "@/lib/db/client";
import { cards, lists } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import { STATUS_DEFAULT_TITLE, type StatusKind } from "@/lib/status";
import {
  CreateListInput, RenameListInput, MoveListInput, ArchiveListInput,
  SetWipLimitInput, SetListStatusKindInput, SetListColorInput, DeleteListInput,
  EnsureStatusListInput, Uuid,
} from "@/lib/validation";

const MoveCardToListInput = z.object({
  cardId: Uuid,
  toListId: Uuid,
  position: z.string().min(1).max(64),
});

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

export async function setWipLimitImpl(token: string, input: { id: string; wipLimit: number | null }) {
  const p = SetWipLimitInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(lists).set({ wipLimit: p.wipLimit })
      .where(eq(lists.id, p.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function setListStatusKindImpl(
  token: string,
  input: {
    id: string;
    statusKind:
      | "todo"
      | "in_progress"
      | "review"
      | "done"
      | "blocked"
      | null;
  },
) {
  const p = SetListStatusKindInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(lists)
      .set({ statusKind: p.statusKind })
      .where(eq(lists.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

/**
 * Plan #epic-as-kanban — idempotent: return the first list on `boardId`
 * whose `status_kind = statusKind`. Create one if none exists. Used by
 * the epic-kanban drag handler so columns appear automatically.
 *
 * Caller must have write access to the board (RLS on lists handles this).
 */
export async function ensureStatusListImpl(
  token: string,
  input: { boardId: string; statusKind: StatusKind },
) {
  const parsed = EnsureStatusListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Fast path: row already exists.
    const [existing] = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.boardId, parsed.boardId),
          eq(lists.statusKind, parsed.statusKind),
        ),
      )
      .limit(1);
    if (existing) return existing;

    // Adoption path: an unmapped list (status_kind IS NULL) whose title
    // matches the canonical STATUS_DEFAULT_TITLE for this kind (case-
    // insensitive) is almost certainly the operator's intended column —
    // claim it instead of creating a duplicate at the end of the board.
    // The first such row by position wins.
    const defaultTitle = STATUS_DEFAULT_TITLE[parsed.statusKind];
    const [adoptable] = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.boardId, parsed.boardId),
          eq(lists.archived, false),
          isNull(lists.statusKind),
          sql`lower(${lists.title}) = lower(${defaultTitle})`,
        ),
      )
      .orderBy(asc(lists.position))
      .limit(1);
    if (adoptable) {
      const [adopted] = await tx
        .update(lists)
        .set({ statusKind: parsed.statusKind })
        .where(eq(lists.id, adoptable.id))
        .returning();
      if (adopted) return adopted;
    }

    // Insert with ON CONFLICT to handle the race against a concurrent
    // call. The unique index from 0054 covers (board_id, status_kind)
    // when status_kind IS NOT NULL.
    const [last] = await tx
      .select({ position: lists.position })
      .from(lists)
      .where(eq(lists.boardId, parsed.boardId))
      .orderBy(desc(lists.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);

    const inserted = await tx
      .insert(lists)
      .values({
        boardId: parsed.boardId,
        title: STATUS_DEFAULT_TITLE[parsed.statusKind],
        position: pos,
        statusKind: parsed.statusKind,
      })
      .onConflictDoNothing({
        target: [lists.boardId, lists.statusKind],
        where: sql`${lists.statusKind} is not null`,
      })
      .returning();

    if (inserted.length > 0) return inserted[0];

    // Lost the race: another concurrent call inserted the row first.
    // Re-SELECT to fetch their winning row.
    const [winner] = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.boardId, parsed.boardId),
          eq(lists.statusKind, parsed.statusKind),
        ),
      )
      .limit(1);
    if (!winner) throw new Error("Forbidden");
    return winner;
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
export async function deleteListImpl(
  token: string,
  input: { id: string },
) {
  const parsed = DeleteListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(lists)
      .where(eq(lists.id, parsed.id))
      .returning({ id: lists.id, boardId: lists.boardId });
    if (r.length === 0) throw new Error("Forbidden");
    return r[0];
  });
}

export async function deleteList(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await deleteListImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  revalidatePath(`/b/${r.boardId}/settings`);
}

export async function archiveList(input: { id: string; archived: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await archiveListImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}

export async function setWipLimit(input: Parameters<typeof setWipLimitImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setWipLimitImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}

export async function setListStatusKind(
  input: Parameters<typeof setListStatusKindImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setListStatusKindImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}

export async function setListColorImpl(
  token: string,
  input: {
    id: string;
    color: "slate" | "amber" | "sky" | "emerald" | "rose" | "violet" | null;
  },
) {
  const p = SetListColorInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(lists)
      .set({ color: p.color })
      .where(eq(lists.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function setListColor(
  input: Parameters<typeof setListColorImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setListColorImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}

export async function moveCardToListImpl(
  token: string,
  input: {
    cardId: string;
    toListId: string;
    position: string;
  },
) {
  const parsed = MoveCardToListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({
        id: cards.id,
        boardId: cards.boardId,
      })
      .from(cards)
      .where(eq(cards.id, parsed.cardId))
      .limit(1);
    if (!card) throw new Error("Forbidden");

    const [toList] = await tx
      .select({
        id: lists.id,
        boardId: lists.boardId,
      })
      .from(lists)
      .where(and(eq(lists.id, parsed.toListId), eq(lists.archived, false)))
      .limit(1);
    if (!toList) throw new Error("Forbidden");
    if (toList.boardId !== card.boardId) {
      throw new Error("Destination list must be on the card's board");
    }

    const [moved] = await tx
      .update(cards)
      .set({ listId: parsed.toListId, position: parsed.position })
      .where(eq(cards.id, parsed.cardId))
      .returning();
    if (!moved) throw new Error("Forbidden");
    return { success: true as const, card: moved };
  });
}

export async function moveCardToList(
  input: Parameters<typeof moveCardToListImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveCardToListImpl(t, input);
  revalidatePath(`/b/${r.card.boardId}`);
  return r;
}
