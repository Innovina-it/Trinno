// ---------------------------------------------------------------------------
// Cross-workspace assigned cards — used by the /me/timeline page.
// Returns all non-archived cards with startDate+targetDate where the authed
// user is owner OR a card member. Optionally filtered to a set of workspaceIds.
// RLS is enforced by dbAsUser.
// ---------------------------------------------------------------------------

import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { meId } from "@/lib/queries/me";
import { listMyGuestWorkspaceIds } from "@/lib/queries/me-guard";
import {
  boards,
  cardMembers,
  cards,
  workspaces,
} from "@/lib/db/schema";

export type CrossWorkspaceCard = {
  id: string;
  title: string;
  type: string;
  parentCardId: string | null;
  startDate: Date;
  targetDate: Date;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
  archived: boolean;
  roadmapOrder: number | null;
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  completedAt: Date | null;
  role: "owner" | "member";
};

const MAX_CROSS_WS_CARDS = 500;

/**
 * Returns cards with both startDate and targetDate set where the authed user
 * is owner or a card member. Ordered by startDate ascending.
 *
 * @param workspaceIds - If provided and non-empty, restricts to those workspaces.
 *                       If omitted or empty, all workspaces visible to the user
 *                       are included (RLS enforces access).
 */
export async function listAssignedAcrossWorkspaces(
  token: string,
  workspaceIds?: string[],
): Promise<CrossWorkspaceCard[]> {
  const userId = await meId(token);
  const guestWsIds = await listMyGuestWorkspaceIds(token, userId);

  return dbAsUser(token, async (tx) => {
    const wsFilter =
      workspaceIds && workspaceIds.length > 0
        ? inArray(boards.workspaceId, workspaceIds)
        : undefined;
    // /me timeline hides guest-workspace content the guest only owns, but
    // keeps cards explicitly assigned to them (see member branch below).
    const excludeGuest =
      guestWsIds.length > 0
        ? notInArray(boards.workspaceId, guestWsIds)
        : undefined;

    const baseSelect = {
      id: cards.id,
      title: cards.title,
      type: cards.type,
      parentCardId: cards.parentCardId,
      startDate: cards.startDate,
      targetDate: cards.targetDate,
      boardId: cards.boardId,
      boardTitle: boards.title,
      workspaceId: boards.workspaceId,
      workspaceName: workspaces.name,
      archived: cards.archived,
      roadmapOrder: cards.roadmapOrder,
      priority: cards.priority,
      completedAt: cards.completedAt,
    };

    const ownerRows = await tx
      .select(baseSelect)
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
          eq(cards.ownerId, userId),
          wsFilter,
          excludeGuest,
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_CROSS_WS_CARDS);

    // Member branch omits `excludeGuest`: a card where the guest is an
    // explicit member (assignee) is a task assigned to them and stays on
    // the timeline even in a guest workspace. Owner rows keep the filter.
    const memberRows = await tx
      .select(baseSelect)
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
          eq(cardMembers.userId, userId),
          wsFilter,
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_CROSS_WS_CARDS);

    // Dedupe: owner wins over member.
    const ownerCardIds = new Set(ownerRows.map((r) => r.id));

    const toCard = (
      r: (typeof ownerRows)[number],
      role: "owner" | "member",
    ): CrossWorkspaceCard => ({
      id: r.id,
      title: r.title,
      type: r.type,
      parentCardId: r.parentCardId ?? null,
      startDate: r.startDate as Date,
      targetDate: r.targetDate as Date,
      boardId: r.boardId,
      boardTitle: r.boardTitle,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      archived: r.archived,
      roadmapOrder: r.roadmapOrder ?? null,
      priority: (r.priority ?? null) as CrossWorkspaceCard["priority"],
      completedAt: (r.completedAt ?? null) as Date | null,
      role,
    });

    const out: CrossWorkspaceCard[] = ownerRows.map((r) => toCard(r, "owner"));
    for (const r of memberRows) {
      if (ownerCardIds.has(r.id)) continue;
      out.push(toCard(r, "member"));
    }

    return out
      .filter((c) => c.startDate && c.targetDate)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, MAX_CROSS_WS_CARDS);
  });
}

/**
 * Returns every card with start + target dates across every workspace the
 * caller can see (RLS-bound). Used by the "common workspace" / all-workspace
 * timeline accessible from the workspace switcher.
 *
 * @param workspaceIds - if provided, restricts to those workspaces.
 */
export async function listAllAcrossWorkspaces(
  token: string,
  workspaceIds?: string[],
): Promise<CrossWorkspaceCard[]> {
  return dbAsUser(token, async (tx) => {
    const wsFilter =
      workspaceIds && workspaceIds.length > 0
        ? inArray(boards.workspaceId, workspaceIds)
        : undefined;

    const rows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        type: cards.type,
        parentCardId: cards.parentCardId,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        boardId: cards.boardId,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
        workspaceName: workspaces.name,
        archived: cards.archived,
        roadmapOrder: cards.roadmapOrder,
        priority: cards.priority,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
          wsFilter,
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_CROSS_WS_CARDS);

    return rows
      .filter((r) => r.startDate && r.targetDate)
      .map(
        (r): CrossWorkspaceCard => ({
          id: r.id,
          title: r.title,
          type: r.type,
          parentCardId: r.parentCardId ?? null,
          startDate: r.startDate as Date,
          targetDate: r.targetDate as Date,
          boardId: r.boardId,
          boardTitle: r.boardTitle,
          workspaceId: r.workspaceId,
          workspaceName: r.workspaceName,
          archived: r.archived,
          roadmapOrder: r.roadmapOrder ?? null,
          priority: (r.priority ?? null) as CrossWorkspaceCard["priority"],
          completedAt: (r.completedAt ?? null) as Date | null,
          // role isn't meaningful here — every card listed, not just yours.
          role: "member",
        }),
      );
  });
}
