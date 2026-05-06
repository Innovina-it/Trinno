import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boards,
  cards,
  cardMembers,
  profiles,
  workspaces,
} from "@/lib/db/schema";

// Cross-workspace people-time view. Returns every dated, non-archived
// card the caller can see (RLS-scoped) joined to its assignees AND its
// owner. The view groups by user; a card may appear under multiple users
// (collaborators + owner). Cap defends against pathological accounts.

export type WorkloadCard = {
  id: string;
  title: string;
  type: string;
  startDate: Date;
  targetDate: Date;
  estimateMin: number | null;
  storyPoints: number | null;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
  // The user this row is bucketed under. A single card surfaces once per
  // assignee + once for its owner if owner is not also assignee.
  userId: string;
  // "owner" rows are emitted even when no card_members exist. "member"
  // rows come from card_members.
  role: "owner" | "member";
};

export type WorkloadProfile = { id: string; displayName: string };

const MAX_WORKLOAD_ROWS = 2000;

export async function listWorkload(
  token: string,
): Promise<{ cards: WorkloadCard[]; profiles: WorkloadProfile[] }> {
  return dbAsUser(token, async (tx) => {
    // Members rows: card_members JOIN cards (with dates) JOIN boards JOIN
    // workspaces. RLS filters to boards the caller can see.
    const memberRows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        type: cards.type,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        estimateMin: cards.estimateMin,
        storyPoints: cards.storyPoints,
        boardId: cards.boardId,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
        workspaceName: workspaces.name,
        userId: cardMembers.userId,
      })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_WORKLOAD_ROWS);

    // Owner rows: cards with owner_id set. Same filter.
    const ownerRows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        type: cards.type,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        estimateMin: cards.estimateMin,
        storyPoints: cards.storyPoints,
        boardId: cards.boardId,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
        workspaceName: workspaces.name,
        userId: cards.ownerId,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
          isNotNull(cards.ownerId),
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_WORKLOAD_ROWS);

    // Dedupe: an owner who is also a member surfaces only once (as owner).
    const memberKey = (cardId: string, userId: string) => `${cardId}:${userId}`;
    const ownerKeys = new Set(
      ownerRows.map((r) => memberKey(r.id, r.userId as string)),
    );

    const out: WorkloadCard[] = [];
    for (const r of ownerRows) {
      if (!r.userId || !r.startDate || !r.targetDate) continue;
      out.push({
        id: r.id,
        title: r.title,
        type: r.type,
        startDate: r.startDate as Date,
        targetDate: r.targetDate as Date,
        estimateMin: r.estimateMin ?? null,
        storyPoints: r.storyPoints ?? null,
        boardId: r.boardId,
        boardTitle: r.boardTitle,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        userId: r.userId,
        role: "owner",
      });
    }
    for (const r of memberRows) {
      if (!r.startDate || !r.targetDate) continue;
      if (ownerKeys.has(memberKey(r.id, r.userId))) continue;
      out.push({
        id: r.id,
        title: r.title,
        type: r.type,
        startDate: r.startDate as Date,
        targetDate: r.targetDate as Date,
        estimateMin: r.estimateMin ?? null,
        storyPoints: r.storyPoints ?? null,
        boardId: r.boardId,
        boardTitle: r.boardTitle,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        userId: r.userId,
        role: "member",
      });
    }

    // Resolve profile names for every distinct user that surfaced.
    const userIds = Array.from(new Set(out.map((c) => c.userId)));
    let profs: WorkloadProfile[] = [];
    if (userIds.length > 0) {
      profs = await tx
        .select({ id: profiles.id, displayName: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, userIds));
    }

    return { cards: out, profiles: profs };
  });
}
