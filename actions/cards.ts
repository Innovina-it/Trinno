"use server";
import { revalidatePath } from "next/cache";
import { eq, desc, asc, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAsUser } from "@/lib/db/client";
import {
  cards,
  cardLinks,
  cardLabels,
  lists,
  boards,
  workspaces,
  workspaceMembers,
  boardMembers,
  cardMembers,
} from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { positionBetween } from "@/lib/ordering";
import {
  CreateCardInput, UpdateCardInput, MoveCardInput, ArchiveCardInput,
  CascadeShiftBlockedInput, ReorderRoadmapRowInput, Uuid, CardPriority,
  BulkSetCompletedInput,
} from "@/lib/validation";
import {
  computeNewRank,
  RANK_STEP,
  RankCollisionError,
} from "@/lib/roadmap/sparse-rank";
import { ensureStatusListImpl } from "@/actions/lists";
import type { StatusKind } from "@/lib/status";

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
const BulkSetPriorityInput = z.object({
  cardIds: z.array(Uuid).min(1).max(50),
  priority: CardPriority.nullable(),
});

// Plan #16b-γ-D (#37) — cross-board move.
const MoveCardCrossBoardInput = z.object({
  cardId: Uuid,
  toListId: Uuid,
});

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createCardImpl(token: string, input: {
  listId: string;
  title: string;
  startDate?: Date | string | null;
  targetDate?: Date | string | null;
  parentCardId?: string | null;
}) {
  const parsed = CreateCardInput.parse(input);
  const creatorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [last] = await tx.select({ position: cards.position }).from(cards)
      .where(eq(cards.listId, parsed.listId))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);

    const toDate = (d: Date | string | null | undefined): Date | null => {
      if (d === null || d === undefined) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };
    let startDate = toDate(parsed.startDate);
    let targetDate = toDate(parsed.targetDate);

    // Subtask date inheritance: if linked to a parent and own dates blank,
    // copy the parent's span. Lets a child default onto the roadmap inside
    // its epic without forcing the user to repick dates.
    if (parsed.parentCardId && (!startDate || !targetDate)) {
      const [parent] = await tx
        .select({ startDate: cards.startDate, targetDate: cards.targetDate })
        .from(cards)
        .where(eq(cards.id, parsed.parentCardId))
        .limit(1);
      if (parent) {
        if (!startDate && parent.startDate) startDate = parent.startDate;
        if (!targetDate && parent.targetDate) targetDate = parent.targetDate;
      }
    }

    const [row] = await tx.insert(cards).values({
      listId: parsed.listId,
      title: parsed.title,
      position: pos,
      boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
      parentCardId: parsed.parentCardId ?? null,
      startDate,
      targetDate,
    }).returning();
    if (!row) throw new Error("Forbidden");

    // Honor the workspace's "auto-assign creator" preference. Resolve
    // workspace via list → board so we don't need it on the input. The
    // insert is best-effort: a card_members write failure shouldn't roll
    // back the card itself, so swallow the error after logging.
    const [ws] = await tx
      .select({ autoAssign: workspaces.autoAssignCreator })
      .from(lists)
      .innerJoin(boards, eq(boards.id, lists.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(eq(lists.id, parsed.listId))
      .limit(1);
    if (ws?.autoAssign) {
      try {
        await tx
          .insert(cardMembers)
          .values({ cardId: row.id, userId: creatorId, boardId: row.boardId });
      } catch {
        /* ignore — card already created; assignment is non-critical */
      }
    }
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
  ownerId?: string | null;
  completed?: boolean;
}) {
  const parsed = UpdateCardInput.parse(input);
  const actorId = decodeSub(token);
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
  if (parsed.ownerId !== undefined) patch.ownerId = parsed.ownerId;
  if (parsed.completed !== undefined) {
    // Set completedAt directly; the DB trigger mirrors dueComplete.
    patch.completedAt = parsed.completed ? new Date() : null;
  }
  return dbAsUser(token, async (tx) => {
    if (parsed.ownerId !== undefined) {
      const [cardAccess] = await tx
        .select({
          boardId: cards.boardId,
          ownerId: cards.ownerId,
          visibility: boards.visibility,
          workspaceId: boards.workspaceId,
        })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .where(eq(cards.id, parsed.id))
        .limit(1);
      if (!cardAccess) throw new Error("Forbidden");

      const [boardMembership] = await tx
        .select({ role: boardMembers.role })
        .from(boardMembers)
        .where(
          and(
            eq(boardMembers.boardId, cardAccess.boardId),
            eq(boardMembers.userId, actorId),
          ),
        )
        .limit(1);
      const [workspaceMembership] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, cardAccess.workspaceId),
            eq(workspaceMembers.userId, actorId),
          ),
        )
        .limit(1);

      const isAdmin =
        boardMembership?.role === "admin" ||
        workspaceMembership?.role === "owner" ||
        workspaceMembership?.role === "admin";
      const isWritableMember =
        boardMembership?.role === "admin" ||
        boardMembership?.role === "member" ||
        (cardAccess.visibility === "workspace" && !!workspaceMembership);
      const isCurrentOwner = cardAccess.ownerId === actorId;
      const isClaimingUnowned =
        cardAccess.ownerId === null && parsed.ownerId === actorId;

      if (!isAdmin && !isCurrentOwner && !(isWritableMember && isClaimingUnowned)) {
        throw new Error(
          "Only admins, the current owner, or a member claiming an unowned card can change owner.",
        );
      }

      if (parsed.ownerId !== null) {
        const [targetBoardMember] = await tx
          .select({ userId: boardMembers.userId })
          .from(boardMembers)
          .where(
            and(
              eq(boardMembers.boardId, cardAccess.boardId),
              eq(boardMembers.userId, parsed.ownerId),
            ),
          )
          .limit(1);
        const [targetWorkspaceMember] = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, cardAccess.workspaceId),
              eq(workspaceMembers.userId, parsed.ownerId),
            ),
          )
          .limit(1);
        const targetCanOwn =
          !!targetBoardMember ||
          (cardAccess.visibility === "workspace" && !!targetWorkspaceMember);
        if (!targetCanOwn) {
          throw new Error("Owner must be a board or workspace member.");
        }
      }
    }

    // Subtask date inheritance on retroactive parent link: if parentCardId
    // is being set to a non-null value AND the card has no dates of its
    // own (and none in this patch), copy parent's span. Mirrors the
    // create-time inheritance in createCardImpl.
    if (parsed.parentCardId) {
      const haveStartInPatch = patch.startDate !== undefined;
      const haveTargetInPatch = patch.targetDate !== undefined;
      if (!haveStartInPatch || !haveTargetInPatch) {
        const [self] = await tx
          .select({ startDate: cards.startDate, targetDate: cards.targetDate })
          .from(cards)
          .where(eq(cards.id, parsed.id))
          .limit(1);
        const needStart = !haveStartInPatch && !self?.startDate;
        const needTarget = !haveTargetInPatch && !self?.targetDate;
        if (needStart || needTarget) {
          const [parent] = await tx
            .select({ startDate: cards.startDate, targetDate: cards.targetDate })
            .from(cards)
            .where(eq(cards.id, parsed.parentCardId))
            .limit(1);
          if (parent) {
            if (needStart && parent.startDate) patch.startDate = parent.startDate;
            if (needTarget && parent.targetDate) patch.targetDate = parent.targetDate;
          }
        }
      }
    }
    try {
      const [row] = await tx.update(cards).set(patch)
        .where(eq(cards.id, parsed.id)).returning();
      if (!row) throw new Error("Forbidden");
      return row;
    } catch (err) {
      // Plan #8 cycle-guard trigger raises 'cards: parent cycle detected'.
      // Wrap into a stable, code-prefixed Error so callers can detect it
      // without matching English substrings (Server Action serializes as
      // a plain Error so the message prefix is the contract).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("parent cycle")) {
        throw new Error("PARENT_CYCLE: parent cycle detected");
      }
      throw err;
    }
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

/**
 * Plan #epic-as-kanban — drag-end handler for the epic-kanban view.
 * Resolves (or creates) a list on the card's board with the target
 * status_kind, then moves the card into it at end-of-list.
 *
 * Sequence (no shared transaction — each impl manages its own dbAsUser
 * scope to avoid pool-connection deadlock under burst load):
 *   1. Probe: read card boardId + its current list's status_kind.
 *   2. No-op short-circuit if already in a matching status_kind list.
 *   3. ensureStatusListImpl resolves (or creates) the target list.
 *   4. Move: end-of-list positional update on cards.
 *
 * Failure between (3) and (4) leaves an orphan empty status column
 * created by step 3. The column is recoverable (admin can rename or
 * delete) and matches the established cross-impl pattern in
 * createBoardFromTemplateImpl.
 *
 * No-op when the card already lives in a list with that status_kind.
 */
export async function moveCardToStatusImpl(
  token: string,
  input: { cardId: string; statusKind: StatusKind },
): Promise<{ cardId: string; listId: string }> {
  const cardId = input.cardId;

  // Phase 1: probe.
  const probe = await dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({ id: cards.id, boardId: cards.boardId, listId: cards.listId })
      .from(cards)
      .where(eq(cards.id, cardId));
    if (!card) return null;
    const [currentList] = await tx
      .select({ id: lists.id, statusKind: lists.statusKind })
      .from(lists)
      .where(eq(lists.id, card.listId));
    return {
      boardId: card.boardId,
      listId: card.listId,
      currentStatusKind: currentList?.statusKind ?? null,
    };
  });
  if (!probe) throw new Error("Forbidden");

  // Phase 2: no-op short-circuit.
  if (probe.currentStatusKind === input.statusKind) {
    return { cardId, listId: probe.listId };
  }

  // Phase 3: resolve / create the target list (own tx).
  const target = await ensureStatusListImpl(token, {
    boardId: probe.boardId,
    statusKind: input.statusKind,
  });

  // Phase 4: positional move (own tx).
  return dbAsUser(token, async (tx) => {
    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, target.id))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    const [row] = await tx
      .update(cards)
      .set({ listId: target.id, position: pos })
      .where(eq(cards.id, cardId))
      .returning();
    if (!row) throw new Error("Forbidden");
    return { cardId, listId: target.id };
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

// Bulk priority assignment. Single UPDATE; RLS drops any id the user
// can't write so partial application is the honest behavior.
export async function bulkSetPriorityImpl(
  token: string,
  input: { cardIds: string[]; priority: "p0" | "p1" | "p2" | "p3" | "p4" | null },
): Promise<{ updated: number }> {
  const p = BulkSetPriorityInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .update(cards)
      .set({ priority: p.priority })
      .where(inArray(cards.id, p.cardIds))
      .returning({ id: cards.id });
    return { updated: r.length };
  });
}

// Bulk mark-complete (or un-complete). Writes `completed_at` only — the
// DB trigger from migration 0062 mirrors `due_complete` automatically so
// legacy code paths keep working without dual-writes. RLS drops any id
// the user can't write so partial application is the honest behavior.
export async function bulkSetCompletedImpl(
  token: string,
  input: { cardIds: string[]; completed: boolean },
): Promise<{ updated: number }> {
  const p = BulkSetCompletedInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .update(cards)
      .set({ completedAt: p.completed ? new Date() : null })
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

// Plan #16b-γ-D (#37) — move a card to a list on another board. RLS
// gates the SELECT of the target list (must be readable) and the
// UPDATE of the card row (the user has write on the destination
// because the destination list's board has them as a member). The
// existing `set_card_board_id` denorm trigger fires on `list_id`
// change so child rows (subtasks, comments, attachments, links) sync
// their `board_id` automatically.
export async function moveCardCrossBoardImpl(
  token: string,
  input: { cardId: string; toListId: string },
): Promise<{
  id: string;
  boardId: string;
  fromBoardId: string;
  listId: string;
  position: string;
}> {
  const p = MoveCardCrossBoardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Resolve destination board via the target list. If the user can't
    // read the list (RLS), this returns 0 rows and we 403.
    const [tlist] = await tx
      .select({ id: lists.id, boardId: lists.boardId })
      .from(lists)
      .where(eq(lists.id, p.toListId));
    if (!tlist) throw new Error("Forbidden");

    // Snapshot the source boardId before the move so the wrapper can
    // revalidate the source page as well — otherwise the source
    // board's RSC cache still shows the moved card until a hard
    // navigation. RLS gates this select; if 0 rows we 403.
    const [src] = await tx
      .select({ boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, p.cardId));
    if (!src) throw new Error("Forbidden");

    // Pick a position at the tail of the destination list.
    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, p.toListId))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);

    // The trigger `set_card_board_id` rewrites `board_id` from the new
    // `list_id`; we still pass the destination's board_id explicitly so
    // a future trigger change doesn't silently let stale denorms creep.
    const [row] = await tx
      .update(cards)
      .set({
        listId: p.toListId,
        boardId: tlist.boardId,
        position: pos,
      })
      .where(eq(cards.id, p.cardId))
      .returning();
    if (!row) throw new Error("Forbidden");
    return {
      id: row.id,
      boardId: row.boardId,
      fromBoardId: src.boardId,
      listId: row.listId,
      position: row.position,
    };
  });
}

export async function moveCardCrossBoard(input: {
  cardId: string;
  toListId: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveCardCrossBoardImpl(t, input);
  // Revalidate both source and destination so the card disappears
  // from the source page and appears on the destination page on
  // the user's next navigation.
  revalidatePath(`/b/${r.boardId}`);
  if (r.fromBoardId !== r.boardId) {
    revalidatePath(`/b/${r.fromBoardId}`);
  }
  return r;
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

export async function bulkSetPriority(
  input: { cardIds: string[]; priority: "p0" | "p1" | "p2" | "p3" | "p4" | null },
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkSetPriorityImpl(t, input);
}

export async function bulkSetCompleted(
  input: { cardIds: string[]; completed: boolean },
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkSetCompletedImpl(t, input);
}

export async function createCard(input: Parameters<typeof createCardImpl>[1]) {
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
// Plan #epic-as-kanban — server-action wrapper for the epic-kanban
// drag-end handler. No `revalidatePath`: the kanban view relies on
// realtime CDC for updates, not Next router cache invalidation.
export async function moveCardToStatus(input: {
  cardId: string; statusKind: StatusKind;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  return moveCardToStatusImpl(t, input);
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

// Plan #16b-γ-G G1 — manual roadmap row reorder.
//
// Sparse-int rank scheme (Linear / Jira pattern): we read the current
// `roadmap_order` of the rows that should land directly above and below
// the moved card after the drop, pick a new rank between them, and write
// that single value. When the gap between neighbours is too small to fit
// an integer midpoint we renumber every card on the board with fresh
// 1024-step ranks (NULLS sort to the bottom by `start_date ASC,
// created_at ASC`) and retry.
//
// Activity logging: the existing `activity_cards_aud` trigger
// (supabase/migrations/0016_activity_triggers.sql) does NOT capture
// `roadmap_order` updates. Rather than extend the enum / trigger and
// roll a second migration in this 2-hr task, we skip the activity row
// for G1 — manual ordering is a UI affordance, not an audit-relevant
// change. Follow-up to add `card.roadmap_order` activity if needed.
export async function reorderRoadmapRowImpl(
  token: string,
  input: {
    cardId: string;
    beforeId: string | null;
    afterId: string | null;
    boardId: string;
  },
): Promise<{ id: string; roadmapOrder: number }> {
  const p = ReorderRoadmapRowInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Serialize concurrent reorders on the same board so the renumber
    // path can't race against a second writer's neighbour-rank reads.
    // Auto-released at txn end.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"reorder:" + p.boardId}))`,
    );

    async function readRank(id: string | null): Promise<number | null> {
      if (id === null) return null;
      const [row] = await tx
        .select({ ord: cards.roadmapOrder })
        .from(cards)
        .where(eq(cards.id, id));
      return row?.ord ?? null;
    }

    let beforeRank = await readRank(p.beforeId);
    let afterRank = await readRank(p.afterId);

    let newRank: number;
    try {
      newRank = computeNewRank(beforeRank, afterRank);
    } catch (err) {
      if (!(err instanceof RankCollisionError)) throw err;
      // Renumber every card on the board with fresh sparse ranks. We
      // sort by current `roadmap_order ASC NULLS LAST`, then by
      // `start_date ASC NULLS LAST`, then by `created_at ASC` so the
      // existing visual order is preserved.
      const all = await tx
        .select({
          id: cards.id,
          ord: cards.roadmapOrder,
          startDate: cards.startDate,
          createdAt: cards.createdAt,
        })
        .from(cards)
        .where(and(eq(cards.boardId, p.boardId), eq(cards.archived, false)))
        .orderBy(
          sql`${cards.roadmapOrder} asc nulls last`,
          sql`${cards.startDate} asc nulls last`,
          asc(cards.createdAt),
        );
      // Bulk update via a single CASE-WHEN statement to keep round-trips
      // bounded.
      let i = 0;
      for (const row of all) {
        const next = (i + 1) * RANK_STEP;
        i++;
        await tx
          .update(cards)
          .set({ roadmapOrder: next })
          .where(eq(cards.id, row.id));
      }
      // Re-read the now-renumbered neighbour ranks and retry the midpoint
      // calc; this time the gap is guaranteed to be ≥ RANK_STEP so it
      // can't collide.
      beforeRank = await readRank(p.beforeId);
      afterRank = await readRank(p.afterId);
      newRank = computeNewRank(beforeRank, afterRank);
    }

    const [row] = await tx
      .update(cards)
      .set({ roadmapOrder: newRank })
      .where(eq(cards.id, p.cardId))
      .returning({ id: cards.id, roadmapOrder: cards.roadmapOrder });
    if (!row) throw new Error("Forbidden");
    return { id: row.id, roadmapOrder: row.roadmapOrder as number };
  });
}

export async function reorderRoadmapRow(input: {
  cardId: string;
  beforeId: string | null;
  afterId: string | null;
  boardId: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  try {
    return await reorderRoadmapRowImpl(t, input);
  } catch (err) {
    const msg = (err as Error).message;
    throw new Error(msg === "Forbidden" ? "Forbidden" : `Reorder failed: ${msg}`);
  }
}
