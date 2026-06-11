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
  CascadeShiftBlockedInput, ShiftCardsByIdsInput, ReorderRoadmapRowInput, Uuid, CardPriority,
  BulkSetCompletedInput, SetRoadmapCompletionInput,
} from "@/lib/validation";
import {
  computeNewRank,
  RANK_STEP,
  RankCollisionError,
} from "@/lib/roadmap/sparse-rank";
import { ensureStatusListImpl } from "@/actions/lists";
import type { StatusKind } from "@/lib/status";
import { StructuredError } from "@/lib/errors";
import {
  assertGuestCardWriteAllowed,
  assertNotGuest,
  getWorkspaceRoleForBoard,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

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

// Roadmap cross-lane drop into a sub_board lane. The lane id IS the
// sub_board's board id, but the client doesn't know which list on that
// board to land in. Server picks a todo-kind list (falling back to the
// first active list).
const MoveCardToBoardInput = z.object({
  cardId: Uuid,
  toBoardId: Uuid,
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
  ownerId?: string | null;
}) {
  const parsed = CreateCardInput.parse(input);
  const creatorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — guests cannot create cards (read-only except status moves).
    const [listBoardForRole] = await tx
      .select({ boardId: lists.boardId })
      .from(lists)
      .where(eq(lists.id, parsed.listId))
      .limit(1);
    if (listBoardForRole?.boardId) {
      assertNotGuest(
        await getWorkspaceRoleForBoard(tx, listBoardForRole.boardId, creatorId),
      );
    }
    // When parentCardId is set, the DB trigger `cards_validate_parent`
    // requires the new card's resolved board (from listId → lists.board_id)
    // to equal the parent's board. The roadmap NewCardDialog can race —
    // when the user opens it with a parent on board X but the default lane
    // is on board Y, the dialog may submit (listId from Y, parentCardId on X).
    // Snap listId to a list on the parent's board here so the create
    // succeeds regardless of client state.
    let effectiveListId = parsed.listId;
    if (parsed.parentCardId) {
      const [parentBoard] = await tx
        .select({ boardId: cards.boardId })
        .from(cards)
        .where(eq(cards.id, parsed.parentCardId))
        .limit(1);
      const [listBoard] = await tx
        .select({ boardId: lists.boardId })
        .from(lists)
        .where(eq(lists.id, parsed.listId))
        .limit(1);
      if (
        parentBoard?.boardId &&
        listBoard?.boardId &&
        parentBoard.boardId !== listBoard.boardId
      ) {
        const candidates = await tx
          .select({
            id: lists.id,
            statusKind: lists.statusKind,
            position: lists.position,
          })
          .from(lists)
          .where(and(eq(lists.boardId, parentBoard.boardId), eq(lists.archived, false)))
          .orderBy(asc(lists.position));
        const target =
          candidates.find((l) => l.statusKind === "todo") ?? candidates[0];
        if (!target) {
          throw new StructuredError(
            "VALIDATION_ERROR",
            "Parent card's board has no list to receive the subtask",
            { kind: "cross-board-no-list" },
          );
        }
        effectiveListId = target.id;
      }
    }

    const [last] = await tx.select({ position: cards.position }).from(cards)
      .where(eq(cards.listId, effectiveListId))
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

    let parentDefaults:
      | { startDate: Date | null; targetDate: Date | null; ownerId: string | null }
      | undefined;
    if (parsed.parentCardId && (!startDate || !targetDate || parsed.ownerId === undefined)) {
      const [parent] = await tx
        .select({
          startDate: cards.startDate,
          targetDate: cards.targetDate,
          ownerId: cards.ownerId,
        })
        .from(cards)
        .where(eq(cards.id, parsed.parentCardId))
        .limit(1);
      parentDefaults = parent;
    }

    // Subtask date inheritance: if linked to a parent and own dates blank,
    // copy the parent's span. Lets a child default onto the roadmap without
    // forcing the user to repick dates.
    if (parentDefaults) {
      if (!startDate && parentDefaults.startDate) startDate = parentDefaults.startDate;
      if (!targetDate && parentDefaults.targetDate) targetDate = parentDefaults.targetDate;
    }

    // Date-ordering invariant (mirrors updateCardImpl): a new card's target
    // must never precede its start, whether the dates came from the client
    // or were inherited from a parent above.
    if (
      startDate instanceof Date &&
      targetDate instanceof Date &&
      targetDate.getTime() < startDate.getTime()
    ) {
      throw new StructuredError(
        "VALIDATION_ERROR",
        "Target date must be on or after start date",
        { kind: "target-before-start" },
      );
    }

    // Default ownerId to the parent owner for subtasks, otherwise creator,
    // when the client didn't supply one.
    // Distinguish "not provided" (undefined) from "explicitly null" so the
    // rare un-owned create stays possible if a caller intentionally passes
    // null. The creator is always a valid claimant — owner-change trigger
    // only fires on UPDATE, never INSERT.
    const ownerId =
      parsed.ownerId === undefined
        ? parentDefaults
          ? parentDefaults.ownerId
          : creatorId
        : parsed.ownerId;

    const [row] = await tx.insert(cards).values({
      listId: effectiveListId,
      title: parsed.title,
      position: pos,
      boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
      parentCardId: parsed.parentCardId ?? null,
      startDate,
      targetDate,
      ownerId,
    }).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");

    // Subtasks inherit the parent's assignees so a child surfaces to the
    // same people without re-picking. Parent-inheritance takes precedence
    // over the workspace "auto-assign creator" default — the creator can
    // still self-assign via the picker if they want to be on the child too.
    if (parsed.parentCardId) {
      const parentMembers = await tx
        .select({ userId: cardMembers.userId })
        .from(cardMembers)
        .where(eq(cardMembers.cardId, parsed.parentCardId));
      if (parentMembers.length > 0) {
        try {
          await tx.insert(cardMembers).values(
            parentMembers.map((m) => ({
              cardId: row.id,
              userId: m.userId,
              boardId: row.boardId,
            })),
          );
        } catch {
          /* best-effort; card already created */
        }
      }
    } else {
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
  type?: "story" | "task" | "subtask" | "bug";
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
    // #0111 — updateCard never touches listId; guests have no path here.
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.id, actorId));
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
      if (!cardAccess) throw new StructuredError("ACCESS_DENIED", "Forbidden");

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
        throw new StructuredError(
          "ROLE_INSUFFICIENT",
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
          throw new StructuredError(
            "VALIDATION_ERROR",
            "Owner must be a board or workspace member.",
            { kind: "owner-not-member" },
          );
        }
      }
    }

    // Cross-board reparent: DB trigger `cards_validate_parent` rejects a
    // parent whose board differs from the card's. When the caller just
    // sets parentCardId (no listId in the patch), snap the card onto a
    // list on the parent's board so the trigger passes. Mirrors the
    // create-time snap in createCardImpl. Skips when caller already
    // supplied a listId (assume they know what they're doing).
    if (parsed.parentCardId && patch.listId === undefined) {
      const [self] = await tx
        .select({ boardId: cards.boardId })
        .from(cards)
        .where(eq(cards.id, parsed.id))
        .limit(1);
      const [parentBoard] = await tx
        .select({ boardId: cards.boardId })
        .from(cards)
        .where(eq(cards.id, parsed.parentCardId))
        .limit(1);
      if (
        self?.boardId &&
        parentBoard?.boardId &&
        self.boardId !== parentBoard.boardId
      ) {
        const candidates = await tx
          .select({
            id: lists.id,
            statusKind: lists.statusKind,
            position: lists.position,
          })
          .from(lists)
          .where(and(eq(lists.boardId, parentBoard.boardId), eq(lists.archived, false)))
          .orderBy(asc(lists.position));
        const target =
          candidates.find((l) => l.statusKind === "todo") ?? candidates[0];
        if (!target) {
          throw new StructuredError(
            "VALIDATION_ERROR",
            "CROSS_BOARD_NO_LIST: parent card's board has no list to receive the card",
            { kind: "cross-board-no-list" },
          );
        }
        patch.listId = target.id;
        const [last] = await tx
          .select({ position: cards.position })
          .from(cards)
          .where(eq(cards.listId, target.id))
          .orderBy(desc(cards.position))
          .limit(1);
        patch.position = positionBetween(last?.position ?? null, null);
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
    // Date-ordering invariant: a card's target must never precede its start,
    // no matter the entry path (quick-view, roadmap drag, a direct action
    // call). The UI pickers floor this, but the server is the real backstop.
    // Validate the *effective* pair — the patch value when present, else the
    // card's currently-stored value — and only read when one side is missing.
    if (patch.startDate !== undefined || patch.targetDate !== undefined) {
      let effStart = patch.startDate as Date | null | undefined;
      let effTarget = patch.targetDate as Date | null | undefined;
      if (effStart === undefined || effTarget === undefined) {
        const [existing] = await tx
          .select({ startDate: cards.startDate, targetDate: cards.targetDate })
          .from(cards)
          .where(eq(cards.id, parsed.id))
          .limit(1);
        if (effStart === undefined) effStart = existing?.startDate ?? null;
        if (effTarget === undefined) effTarget = existing?.targetDate ?? null;
      }
      if (
        effStart instanceof Date &&
        effTarget instanceof Date &&
        effTarget.getTime() < effStart.getTime()
      ) {
        throw new StructuredError(
          "VALIDATION_ERROR",
          "Target date must be on or after start date",
          { kind: "target-before-start" },
        );
      }
    }
    try {
      const [row] = await tx.update(cards).set(patch)
        .where(eq(cards.id, parsed.id)).returning();
      if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
      return row;
    } catch (err) {
      // Plan #8 cycle-guard trigger raises 'cards: parent cycle detected'.
      // Wrap into a stable, code-prefixed Error so callers can detect it
      // without matching English substrings (Server Action serializes as
      // a plain Error so the message prefix is the contract).
      const cause = (err as { cause?: { message?: string } })?.cause?.message;
      const msg = (err instanceof Error ? err.message : String(err)) + " " + (cause ?? "");
      const lower = msg.toLowerCase();
      if (lower.includes("parent cycle")) {
        throw new StructuredError(
          "VALIDATION_ERROR",
          "PARENT_CYCLE: parent cycle detected",
          { kind: "parent-cycle" },
        );
      }
      if (lower.includes("parent must be in same board")) {
        throw new StructuredError(
          "VALIDATION_ERROR",
          "CROSS_BOARD_PARENT: parent must be in same board",
          { kind: "cross-board-parent" },
        );
      }
      throw err;
    }
  });
}

export async function moveCardImpl(token: string, input: {
  id: string; listId: string; position: string;
}) {
  const parsed = MoveCardInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — guests may move (change listId of) cards assigned to them.
    const role = await getWorkspaceRoleForCard(tx, parsed.id, actorId);
    if (role === "guest") {
      await assertGuestCardWriteAllowed(tx, role, parsed.id, actorId, ["listId"]);
    }
    const [row] = await tx.update(cards)
      .set({ listId: parsed.listId, position: parsed.position })
      .where(eq(cards.id, parsed.id)).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

/**
 * Sub-board status drag handler.
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
  const actorId = decodeSub(token);

  // Phase 1: probe (+ #0111 guest gate for assigned cards only).
  const probe = await dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({ id: cards.id, boardId: cards.boardId, listId: cards.listId })
      .from(cards)
      .where(eq(cards.id, cardId));
    if (!card) return null;
    const role = await getWorkspaceRoleForBoard(tx, card.boardId, actorId);
    if (role === "guest") {
      await assertGuestCardWriteAllowed(tx, role, cardId, actorId, ["listId"]);
    }
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
  if (!probe) throw new StructuredError("ACCESS_DENIED", "Forbidden");

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
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { cardId, listId: target.id };
  });
}

/**
 * Roadmap complete-toggle handler. Keeps the board list in lockstep with
 * the gantt completion state — WITHOUT touching updateCard (which by
 * invariant #0111 never changes listId).
 *
 * completed=true:
 *   - if the card is not already in a 'done' list: record its current
 *     list in pre_done_list_id, then move it to the board's 'done' list
 *     (moveCardToStatusImpl creates one if the board has none).
 *   - stamp completed_at = now().
 * completed=false:
 *   - clear completed_at and pre_done_list_id.
 *   - revert ONLY if the card is currently in a 'done' list AND we have a
 *     stored pre_done_list_id (still present — FK is ON DELETE SET NULL).
 *     If the user manually moved it elsewhere after completing, leave it.
 *
 * No shared transaction across the move impls — matches the established
 * cross-impl pattern (moveCardToStatusImpl, syncParentFromSubtaskImpl).
 */
export async function setRoadmapCompletionImpl(
  token: string,
  input: { cardId: string; completed: boolean },
): Promise<{ cardId: string; boardId: string; listId: string }> {
  const parsed = SetRoadmapCompletionInput.parse(input);
  const actorId = decodeSub(token);

  const probe = await dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({
        boardId: cards.boardId,
        listId: cards.listId,
        preDoneListId: cards.preDoneListId,
      })
      .from(cards)
      .where(eq(cards.id, parsed.cardId));
    if (!card) return null;
    // Completion is a non-guest write (mirrors updateCardImpl's gate).
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.cardId, actorId));
    const [list] = await tx
      .select({ statusKind: lists.statusKind })
      .from(lists)
      .where(eq(lists.id, card.listId));
    return {
      boardId: card.boardId,
      listId: card.listId,
      preDoneListId: card.preDoneListId,
      currentStatusKind: list?.statusKind ?? null,
    };
  });
  if (!probe) throw new StructuredError("ACCESS_DENIED", "Forbidden");

  let resultListId = probe.listId;

  if (parsed.completed) {
    const movingToDone = probe.currentStatusKind !== "done";
    await dbAsUser(token, (tx) =>
      tx
        .update(cards)
        .set(
          movingToDone
            ? { completedAt: new Date(), preDoneListId: probe.listId }
            : { completedAt: new Date() },
        )
        .where(eq(cards.id, parsed.cardId)),
    );
    if (movingToDone) {
      const moved = await moveCardToStatusImpl(token, {
        cardId: parsed.cardId,
        statusKind: "done",
      });
      resultListId = moved.listId;
    }
  } else {
    const reverting =
      probe.currentStatusKind === "done" && probe.preDoneListId != null;
    await dbAsUser(token, (tx) =>
      tx
        .update(cards)
        .set({ completedAt: null, preDoneListId: null })
        .where(eq(cards.id, parsed.cardId)),
    );
    if (reverting) {
      const pos = await dbAsUser(token, async (tx) => {
        const [last] = await tx
          .select({ position: cards.position })
          .from(cards)
          .where(eq(cards.listId, probe.preDoneListId!))
          .orderBy(desc(cards.position))
          .limit(1);
        return positionBetween(last?.position ?? null, null);
      });
      const moved = await moveCardImpl(token, {
        id: parsed.cardId,
        listId: probe.preDoneListId!,
        position: pos,
      });
      resultListId = moved.listId;
    }
  }

  return { cardId: parsed.cardId, boardId: probe.boardId, listId: resultListId };
}

export async function archiveCardImpl(token: string, input: { id: string; archived: boolean }) {
  const parsed = ArchiveCardInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — archive is not a status move; guests are blocked.
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.id, actorId));
    const [row] = await tx.update(cards).set({ archived: parsed.archived })
      .where(eq(cards.id, parsed.id)).returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — cascade-shift writes dates on dependents; guests blocked.
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.cardId, actorId));
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

// undo-redo-stack Unit B2 — shift a KNOWN id set by N days. Exact
// inverse/replay of a cascade shift: no dependency re-walk, so undo and
// redo touch precisely the cards the original shift reported. RLS drops
// any id the user can't write so partial application is the honest
// behavior.
export async function shiftCardsByIdsImpl(
  token: string,
  input: { cardIds: string[]; deltaDays: number },
): Promise<{ shifted: { id: string; deltaDays: number }[] }> {
  const p = ShiftCardsByIdsInput.parse(input);
  if (p.deltaDays === 0) return { shifted: [] };
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    const rows = await tx
      .select({
        id: cards.id,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
      })
      .from(cards)
      .where(inArray(cards.id, p.cardIds));
    const shiftMs = p.deltaDays * MS_PER_DAY;
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
      if (u) updated.push({ id: r.id, deltaDays: p.deltaDays });
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — bulk-archive is not a status move; reject guests.
    if (p.cardIds.length > 0) {
      assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    }
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    if (p.cardIds.length > 0) {
      assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    }
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    if (p.cardIds.length > 0) {
      assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    }
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    if (p.cardIds.length > 0) {
      assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    }
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    if (p.cardIds.length > 0) {
      assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardIds[0]!, actorId));
    }
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
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — cross-board move is a structural change (boardId update +
    // possible parent reparent), not a status move; reject guests.
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    // Resolve destination board via the target list. If the user can't
    // read the list (RLS), this returns 0 rows and we 403.
    const [tlist] = await tx
      .select({ id: lists.id, boardId: lists.boardId })
      .from(lists)
      .where(eq(lists.id, p.toListId));
    if (!tlist) throw new StructuredError("ACCESS_DENIED", "Forbidden");

    // Snapshot the source boardId before the move so the wrapper can
    // revalidate the source page as well — otherwise the source
    // board's RSC cache still shows the moved card until a hard
    // navigation. RLS gates this select; if 0 rows we 403.
    const [src] = await tx
      .select({ boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, p.cardId));
    if (!src) throw new StructuredError("ACCESS_DENIED", "Forbidden");

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
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return {
      id: row.id,
      boardId: row.boardId,
      fromBoardId: src.boardId,
      listId: row.listId,
      position: row.position,
    };
  });
}

export async function moveCardToBoardImpl(
  token: string,
  input: { cardId: string; toBoardId: string },
): Promise<{
  id: string;
  boardId: string;
  fromBoardId: string;
  listId: string;
  position: string;
}> {
  const p = MoveCardToBoardInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    const candidates = await tx
      .select({
        id: lists.id,
        statusKind: lists.statusKind,
        position: lists.position,
      })
      .from(lists)
      .where(and(eq(lists.boardId, p.toBoardId), eq(lists.archived, false)))
      .orderBy(asc(lists.position));
    const target =
      candidates.find((l) => l.statusKind === "todo") ?? candidates[0];
    if (!target) {
      throw new StructuredError(
        "VALIDATION_ERROR",
        "CROSS_BOARD_NO_LIST: destination board has no list to receive the card",
        { kind: "cross-board-no-list" },
      );
    }
    const [src] = await tx
      .select({ boardId: cards.boardId, parentCardId: cards.parentCardId, type: cards.type })
      .from(cards)
      .where(eq(cards.id, p.cardId));
    if (!src) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, target.id))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);
    // Cross-board move must respect `cards_validate_parent` (same-board
    // parent). If the card has a parent on the OLD board, the parent
    // link no longer applies — clear it. Keep it only when the parent
    // already lives on the destination board. Subtasks REQUIRE a
    // parent (cards_subtask_parent_check); clearing would break the
    // check, so reject the move instead of silently corrupting state.
    const updates: {
      listId: string;
      boardId: string;
      position: string;
      parentCardId?: string | null;
    } = { listId: target.id, boardId: p.toBoardId, position: pos };
    if (src.parentCardId) {
      const [parent] = await tx
        .select({ boardId: cards.boardId })
        .from(cards)
        .where(eq(cards.id, src.parentCardId))
        .limit(1);
      if (parent?.boardId !== p.toBoardId) {
        if (src.type === "subtask") {
          throw new StructuredError(
            "VALIDATION_ERROR",
            "CROSS_BOARD_SUBTASK_BLOCKED: cannot move a subtask away from its parent's board",
            { kind: "cross-board-subtask-blocked" },
          );
        }
        updates.parentCardId = null;
      }
    }
    const [row] = await tx
      .update(cards)
      .set(updates)
      .where(eq(cards.id, p.cardId))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return {
      id: row.id,
      boardId: row.boardId,
      fromBoardId: src.boardId,
      listId: row.listId,
      position: row.position,
    };
  });
}

export async function moveCardToBoard(input: {
  cardId: string;
  toBoardId: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveCardToBoardImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  if (r.fromBoardId !== r.boardId) {
    revalidatePath(`/b/${r.fromBoardId}`);
  }
  return r;
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
// Server-action wrapper for status-column drag. No `revalidatePath`:
// the kanban view relies on realtime CDC for updates, not Next router
// cache invalidation.
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
export async function setRoadmapCompletion(input: {
  cardId: string; completed: boolean;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setRoadmapCompletionImpl(t, input);
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

// No revalidatePath — roadmap/board views reconcile via realtime CDC,
// matching cascadeShiftBlockedAfter.
export async function shiftCardsByIds(
  input: Parameters<typeof shiftCardsByIdsImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return shiftCardsByIdsImpl(t, input);
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
    workspaceId: string;
  },
): Promise<{ id: string; roadmapOrder: number }> {
  const p = ReorderRoadmapRowInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    // #0111 — roadmap reorder is a write across many cards; reject guests.
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    // Serialize concurrent reorders within the same workspace so the
    // renumber path can't race against a second writer's neighbour-rank
    // reads. The roadmap view is workspace-scoped (lanes mix anchors +
    // orphans from many boards), so locking per-board would let two
    // simultaneous drags on sibling boards collide on shared ranks.
    // Auto-released at txn end.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"reorder:" + p.workspaceId}))`,
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
      // Renumber every non-archived, non-subtask card in the WORKSPACE
      // with fresh sparse ranks. roadmap_order is compared across boards
      // (lanes mix anchors + orphans from many boards), so renumbering
      // only the drop board would leave neighbour ranks on sibling
      // boards untouched and re-collide on retry. We sort by current
      // `roadmap_order ASC NULLS LAST`, then `start_date ASC NULLS LAST`,
      // then `created_at ASC` so the existing visual order is preserved.
      const all = await tx
        .select({
          id: cards.id,
          ord: cards.roadmapOrder,
          startDate: cards.startDate,
          createdAt: cards.createdAt,
        })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .where(
          and(
            eq(boards.workspaceId, p.workspaceId),
            eq(cards.archived, false),
            sql`${cards.type} <> 'subtask'`,
          ),
        )
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
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { id: row.id, roadmapOrder: row.roadmapOrder as number };
  });
}

export async function reorderRoadmapRow(input: {
  cardId: string;
  beforeId: string | null;
  afterId: string | null;
  boardId: string;
  workspaceId: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  try {
    return await reorderRoadmapRowImpl(t, input);
  } catch (err) {
    if (err instanceof StructuredError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new StructuredError("ACTION_FAILED", `Reorder failed: ${msg}`);
  }
}

// User-driven parent status sync triggered from the sub-tasks UI after
// a confirmation modal. Replaces the DB autocomplete trigger removed in
// migration 0109. Two intents:
//   - 'done':        flip parent.completed_at = now AND move it to the
//                    board's 'done'-statusKind list.
//   - 'in_progress': clear parent.completed_at AND move it to the board's
//                    'in_progress'-statusKind list.
// Both calls run under the same JWT, so the activity rows emitted by
// triggers 0086 (card.complete / card.uncomplete) and 0016/0036/0047
// (card.move) are attributed to the actor — not to a hidden cascade.
const SyncParentFromSubtaskInput = z.object({
  parentCardId: Uuid,
  intent: z.enum(["done", "in_progress"]),
});

export async function syncParentFromSubtaskImpl(
  token: string,
  input: { parentCardId: string; intent: "done" | "in_progress" },
): Promise<{
  cardId: string;
  listId: string;
  completedAt: Date | null;
  boardId: string | null;
}> {
  const parsed = SyncParentFromSubtaskInput.parse(input);
  const wantComplete = parsed.intent === "done";
  const statusKind: StatusKind = wantComplete ? "done" : "in_progress";
  const actorId = decodeSub(token);

  // Step 1: completed_at flip (idempotent — no-op write if already in
  // target state, so the 0086 activity trigger stays silent). Also
  // returns boardId so the wrapper can revalidate without a second
  // round-trip.
  const { completedAt, boardId } = await dbAsUser(token, async (tx) => {
    // #0111 — sync-parent flips parent.completedAt and moves it; a guest
    // cannot drive a parent's status from a subtask. Reject.
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.parentCardId, actorId));
    const [current] = await tx
      .select({ completedAt: cards.completedAt, boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, parsed.parentCardId))
      .limit(1);
    if (!current) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    const isComplete = current.completedAt != null;
    if (isComplete === wantComplete) {
      return { completedAt: current.completedAt, boardId: current.boardId };
    }
    const next = wantComplete ? new Date() : null;
    const [row] = await tx
      .update(cards)
      .set({ completedAt: next })
      .where(eq(cards.id, parsed.parentCardId))
      .returning({ completedAt: cards.completedAt, boardId: cards.boardId });
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { completedAt: row.completedAt, boardId: row.boardId };
  });

  // Step 2: column move. moveCardToStatusImpl is idempotent — short-
  // circuits when the card already lives on a list of the target kind.
  const moved = await moveCardToStatusImpl(token, {
    cardId: parsed.parentCardId,
    statusKind,
  });

  return { cardId: moved.cardId, listId: moved.listId, completedAt, boardId };
}

export async function syncParentFromSubtask(input: {
  parentCardId: string;
  intent: "done" | "in_progress";
  /**
   * Optional. When the caller already knows the parent's board (it
   * usually does — the prompt is mounted inside BoardStoreProvider),
   * pass it through to skip the extra read used for revalidatePath.
   */
  boardId?: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await syncParentFromSubtaskImpl(t, input);
  const boardId = input.boardId ?? r.boardId;
  if (boardId) revalidatePath(`/b/${boardId}`);
  return r;
}
