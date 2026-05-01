"use server";
import { revalidatePath } from "next/cache";
import { eq, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { dbAsUser } from "@/lib/db/client";
import { cards, cardLinks, cardLabels } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import {
  CreateCardInput, UpdateCardInput, MoveCardInput, ArchiveCardInput,
  CascadeShiftBlockedInput, Uuid,
} from "@/lib/validation";

// Plan #16b-γ-D (#8) — bulk-action validators.
//
// All capped at 50 ids/call so a single transaction stays bounded; the
// UI bulk-action bar enforces the same cap.
const BulkArchiveInput = z.object({
  cardIds: z.array(Uuid).min(1).max(50),
  archived: z.boolean(),
});
const BulkSetSprintInput = z.object({
  cardIds: z.array(Uuid).min(1).max(50),
  sprintId: Uuid.nullable(),
});
const BulkAddLabelInput = z.object({
  cardIds: z.array(Uuid).min(1).max(50),
  labelId: Uuid,
});

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
  type?: "epic" | "story" | "task" | "subtask" | "bug";
  parentCardId?: string | null;
  storyPoints?: number | null;
  estimateMin?: number | null;
  startDate?: Date | string | null;
  targetDate?: Date | string | null;
  priority?: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  coverKind?: "none" | "color" | "image";
  coverValue?: string | null;
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
  if (parsed.type !== undefined) patch.type = parsed.type;
  if (parsed.parentCardId !== undefined) patch.parentCardId = parsed.parentCardId;
  if (parsed.storyPoints !== undefined) patch.storyPoints = parsed.storyPoints;
  if (parsed.estimateMin !== undefined) patch.estimateMin = parsed.estimateMin;
  if (parsed.startDate !== undefined) {
    patch.startDate =
      parsed.startDate === null
        ? null
        : parsed.startDate instanceof Date
          ? parsed.startDate
          : new Date(parsed.startDate);
  }
  if (parsed.targetDate !== undefined) {
    patch.targetDate =
      parsed.targetDate === null
        ? null
        : parsed.targetDate instanceof Date
          ? parsed.targetDate
          : new Date(parsed.targetDate);
  }
  if (parsed.priority !== undefined) patch.priority = parsed.priority;
  if (parsed.coverKind !== undefined) patch.coverKind = parsed.coverKind;
  if (parsed.coverValue !== undefined) patch.coverValue = parsed.coverValue;
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

const CASCADE_DEPTH_CAP = 50;
const MS_PER_DAY = 86_400_000;

/**
 * Plan #16b-γ-A (#4) — shift the start_date and target_date of every
 * card transitively blocked by `cardId` by `deltaDays`. We follow
 * `card_links.kind = 'is_blocked_by'` rows where `to_card_id = current`
 * (the row says "from is blocked by to") so the *dependents* are the
 * `from` side. Visited set prevents cycles; depth cap prevents pathological
 * graphs from running away. Single transaction so all-or-nothing.
 *
 * Returns the list of shifted ids with the applied deltaDays so the UI
 * can show a confirmation summary.
 */
export async function cascadeShiftBlockedAfterImpl(
  token: string,
  input: { cardId: string; deltaDays: number },
): Promise<{ shifted: { id: string; deltaDays: number }[] }> {
  const parsed = CascadeShiftBlockedInput.parse(input);
  if (parsed.deltaDays === 0) return { shifted: [] };
  return dbAsUser(token, async (tx) => {
    const visited = new Set<string>([parsed.cardId]);
    const dependents: string[] = [];
    let frontier: string[] = [parsed.cardId];
    for (let depth = 0; depth < CASCADE_DEPTH_CAP; depth++) {
      if (frontier.length === 0) break;
      // For each card in the frontier, find rows where it is the BLOCKER
      // (`to_card_id`); the `from_card_id` side is the dependent.
      const rows = await tx
        .select({
          fromId: cardLinks.fromCardId,
          toId: cardLinks.toCardId,
        })
        .from(cardLinks)
        .where(
          and(
            inArray(cardLinks.toCardId, frontier),
            eq(cardLinks.kind, "is_blocked_by"),
          ),
        );
      const next: string[] = [];
      for (const r of rows) {
        if (visited.has(r.fromId)) continue;
        visited.add(r.fromId);
        dependents.push(r.fromId);
        next.push(r.fromId);
      }
      frontier = next;
    }
    if (dependents.length === 0) return { shifted: [] };

    // Read current dates for everyone we're shifting, then write back the
    // new values in one round-trip.
    const rows = await tx
      .select({
        id: cards.id,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
      })
      .from(cards)
      .where(inArray(cards.id, dependents));

    const shiftMs = parsed.deltaDays * MS_PER_DAY;
    const updated: { id: string; deltaDays: number }[] = [];
    for (const r of rows) {
      const patch: Record<string, Date | null> = {};
      if (r.startDate)
        patch.startDate = new Date(r.startDate.getTime() + shiftMs);
      if (r.targetDate)
        patch.targetDate = new Date(r.targetDate.getTime() + shiftMs);
      if (Object.keys(patch).length === 0) continue;
      const [u] = await tx
        .update(cards)
        .set(patch)
        .where(eq(cards.id, r.id))
        .returning();
      if (u) updated.push({ id: r.id, deltaDays: parsed.deltaDays });
    }
    return { shifted: updated };
  });
}

// Plan #16b-γ-D (#8) — bulk archive. Single UPDATE keeps it cheap; RLS
// drops any id the user can't write to so partial application is the
// honest behavior.
export async function bulkArchiveCardsImpl(
  token: string,
  input: { cardIds: string[]; archived: boolean },
): Promise<{ updated: number }> {
  const p = BulkArchiveInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .update(cards)
      .set({ archived: p.archived })
      .where(inArray(cards.id, p.cardIds))
      .returning({ id: cards.id });
    return { updated: r.length };
  });
}

// Plan #16b-γ-D (#8) — bulk sprint assignment.
export async function bulkSetSprintImpl(
  token: string,
  input: { cardIds: string[]; sprintId: string | null },
): Promise<{ updated: number }> {
  const p = BulkSetSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .update(cards)
      .set({ sprintId: p.sprintId })
      .where(inArray(cards.id, p.cardIds))
      .returning({ id: cards.id });
    return { updated: r.length };
  });
}

// Plan #16b-γ-D (#8) — bulk add label. Idempotent thanks to ON CONFLICT;
// the cards-must-share-board invariant is enforced by the existing
// `set_card_label_board_id` trigger which throws when the label's
// board_id doesn't match the card's. The bulk-bar restricts label
// choices to the current board so this only fails on race conditions.
export async function bulkAddLabelImpl(
  token: string,
  input: { cardIds: string[]; labelId: string },
): Promise<{ inserted: number }> {
  const p = BulkAddLabelInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const rows = p.cardIds.map((id) => ({
      cardId: id,
      labelId: p.labelId,
      boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
    }));
    const r = await tx
      .insert(cardLabels)
      .values(rows)
      .onConflictDoNothing()
      .returning({ cardId: cardLabels.cardId });
    return { inserted: r.length };
  });
}

export async function bulkArchiveCards(
  input: { cardIds: string[]; archived: boolean },
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkArchiveCardsImpl(t, input);
}

export async function bulkSetSprint(
  input: { cardIds: string[]; sprintId: string | null },
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkSetSprintImpl(t, input);
}

export async function bulkAddLabel(
  input: { cardIds: string[]; labelId: string },
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkAddLabelImpl(t, input);
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

export async function cascadeShiftBlockedAfter(
  input: Parameters<typeof cascadeShiftBlockedAfterImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await cascadeShiftBlockedAfterImpl(t, input);
  return r;
}
