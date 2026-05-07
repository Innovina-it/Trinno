import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boards,
  cards,
  cardMembers,
  lists,
  profiles,
  sprints,
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
  dueDate: Date | null;
  estimateMin: number | null;
  storyPoints: number | null;
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  statusKind: "todo" | "in_progress" | "review" | "done" | "blocked" | null;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
  sprintId: string | null;
  sprintName: string | null;
  // The user this row is bucketed under. A single card surfaces once per
  // assignee + once for its owner if owner is not also assignee.
  userId: string;
  // "owner" rows are emitted even when no card_members exist. "member"
  // rows come from card_members.
  role: "owner" | "member";
};

export type WorkloadProfile = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};

const MAX_WORKLOAD_ROWS = 2000;

export async function listWorkload(
  token: string,
): Promise<{ cards: WorkloadCard[]; profiles: WorkloadProfile[] }> {
  return dbAsUser(token, async (tx) => {
    const baseSelect = {
      id: cards.id,
      title: cards.title,
      type: cards.type,
      startDate: cards.startDate,
      targetDate: cards.targetDate,
      dueDate: cards.dueDate,
      estimateMin: cards.estimateMin,
      storyPoints: cards.storyPoints,
      priority: cards.priority,
      statusKind: lists.statusKind,
      boardId: cards.boardId,
      boardTitle: boards.title,
      workspaceId: boards.workspaceId,
      workspaceName: workspaces.name,
      sprintId: cards.sprintId,
      sprintName: sprints.name,
    };

    // Members rows: card_members JOIN cards (with dates) JOIN lists JOIN
    // boards JOIN workspaces (LEFT JOIN sprints). RLS filters by board
    // visibility.
    const memberRows = await tx
      .select({ ...baseSelect, userId: cardMembers.userId })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .leftJoin(sprints, eq(sprints.id, cards.sprintId))
      .where(
        and(
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_WORKLOAD_ROWS);

    const ownerRows = await tx
      .select({ ...baseSelect, userId: cards.ownerId })
      .from(cards)
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .leftJoin(sprints, eq(sprints.id, cards.sprintId))
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

    type Row = (typeof memberRows)[number];
    const toCard = (r: Row, role: "owner" | "member"): WorkloadCard => ({
      id: r.id,
      title: r.title,
      type: r.type,
      startDate: r.startDate as Date,
      targetDate: r.targetDate as Date,
      dueDate: (r.dueDate ?? null) as Date | null,
      estimateMin: r.estimateMin ?? null,
      storyPoints: r.storyPoints ?? null,
      priority: (r.priority ?? null) as WorkloadCard["priority"],
      statusKind: (r.statusKind ?? null) as WorkloadCard["statusKind"],
      boardId: r.boardId,
      boardTitle: r.boardTitle,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      sprintId: (r.sprintId ?? null) as string | null,
      sprintName: (r.sprintName ?? null) as string | null,
      userId: r.userId as string,
      role,
    });

    const out: WorkloadCard[] = [];
    for (const r of ownerRows) {
      if (!r.userId || !r.startDate || !r.targetDate) continue;
      out.push(toCard(r as Row, "owner"));
    }
    for (const r of memberRows) {
      if (!r.startDate || !r.targetDate) continue;
      if (ownerKeys.has(memberKey(r.id, r.userId))) continue;
      out.push(toCard(r, "member"));
    }

    // Resolve profile names + handle + avatar for every distinct user.
    const userIds = Array.from(new Set(out.map((c) => c.userId)));
    let profs: WorkloadProfile[] = [];
    if (userIds.length > 0) {
      profs = await tx
        .select({
          id: profiles.id,
          displayName: profiles.displayName,
          handle: profiles.handle,
          avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(inArray(profiles.id, userIds));
    }

    return { cards: out, profiles: profs };
  });
}
