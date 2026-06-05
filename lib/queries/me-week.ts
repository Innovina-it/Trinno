import { and, asc, eq, gte, isNotNull, lte, notInArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, cards, cardMembers, lists, workspaces } from "@/lib/db/schema";
import { meId } from "@/lib/queries/me";
import { listMyGuestWorkspaceIds } from "@/lib/queries/me-guard";
import type { StatusKind } from "@/lib/status";

export type MyWeekCard = {
  id: string;
  title: string;
  type: string;
  startDate: Date;
  targetDate: Date;
  estimateMin: number | null;
  storyPoints: number | null;
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  statusKind: StatusKind | null;
  completedAt: Date | null;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};

const MAX_MY_WEEK_ROWS = 200;

// Cards assigned to the current user (owner OR member) where the
// [startDate, targetDate] interval intersects the next 14 days starting
// from local UTC midnight today. archived=false. Dedupe across owner +
// member. Limit 200. Order by startDate asc.
export async function listMyWeekCards(
  token: string,
): Promise<MyWeekCard[]> {
  const userId = await meId(token);
  const guestWsIds = await listMyGuestWorkspaceIds(token, userId);
  const excludeGuest =
    guestWsIds.length > 0
      ? notInArray(boards.workspaceId, guestWsIds)
      : undefined;

  return dbAsUser(token, async (tx) => {
    const now = new Date();
    const todayMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const windowEnd = new Date(todayMidnight.getTime() + 14 * 24 * 60 * 60 * 1000);

    const baseSelect = {
      id: cards.id,
      title: cards.title,
      type: cards.type,
      startDate: cards.startDate,
      targetDate: cards.targetDate,
      estimateMin: cards.estimateMin,
      storyPoints: cards.storyPoints,
      priority: cards.priority,
      statusKind: lists.statusKind,
      completedAt: cards.completedAt,
      boardId: cards.boardId,
      boardTitle: boards.title,
      workspaceId: boards.workspaceId,
      workspaceName: workspaces.name,
    };

    const dateFilter = and(
      eq(cards.archived, false),
      isNotNull(cards.startDate),
      isNotNull(cards.targetDate),
      // interval [startDate, targetDate] intersects [today, today+14]:
      // startDate <= windowEnd AND targetDate >= today
      lte(cards.startDate, windowEnd),
      gte(cards.targetDate, todayMidnight),
    );

    // Owner rows
    const ownerRows = await tx
      .select({ ...baseSelect })
      .from(cards)
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          dateFilter,
          isNotNull(cards.ownerId),
          eq(cards.ownerId, userId),
          excludeGuest,
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_MY_WEEK_ROWS);

    // Member rows — omit `excludeGuest`: cards where the guest is an
    // assignee in a shared workspace are "tasks assigned to you" and stay
    // visible. Owner rows keep the guest filter above.
    const memberRows = await tx
      .select({ ...baseSelect })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          dateFilter,
          eq(cardMembers.userId, userId),
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_MY_WEEK_ROWS);

    // Dedupe: owner rows take precedence
    const ownerIds = new Set(ownerRows.map((r) => r.id));

    type Row = (typeof ownerRows)[number];
    const toCard = (r: Row): MyWeekCard => ({
      id: r.id,
      title: r.title,
      type: r.type,
      startDate: r.startDate as Date,
      targetDate: r.targetDate as Date,
      estimateMin: r.estimateMin ?? null,
      storyPoints: r.storyPoints ?? null,
      priority: (r.priority ?? null) as MyWeekCard["priority"],
      statusKind: (r.statusKind ?? null) as MyWeekCard["statusKind"],
      completedAt: (r.completedAt ?? null) as Date | null,
      boardId: r.boardId,
      boardTitle: r.boardTitle,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
    });

    const out: MyWeekCard[] = [];
    for (const r of ownerRows) {
      if (!r.startDate || !r.targetDate) continue;
      out.push(toCard(r));
    }
    for (const r of memberRows) {
      if (!r.startDate || !r.targetDate) continue;
      if (ownerIds.has(r.id)) continue;
      out.push(toCard(r));
    }

    // Sort merged results by startDate asc and cap at limit
    out.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return out.slice(0, MAX_MY_WEEK_ROWS);
  });
}
