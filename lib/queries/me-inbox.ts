// Panel D query helpers for the /me home dashboard.
// Inbox, Watchlist, and Blockers queries scoped via RLS through dbAsUser.

import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import { meId, dbAsUser } from "@/lib/queries/me";
import {
  notifications,
  cards,
  boards,
  profiles,
  cardWatchers,
  cardLinks,
  cardMembers,
  activity,
  workspaces,
} from "@/lib/db/schema";

export type InboxItem = {
  id: string;
  kind: string;
  cardId: string | null;
  cardTitle: string | null;
  boardId: string | null;
  actorName: string | null;
  createdAt: Date;
  readAt: Date | null;
};

export type WatchedCard = {
  id: string;
  title: string;
  boardId: string;
  boardTitle: string;
  workspaceName: string;
  completedAt: Date | null;
  lastActivityAt: Date | null;
};

export type BlockingMyCard = {
  // The card I own/am-on, that something else blocks.
  myCardId: string;
  myCardTitle: string;
  // The blocker.
  blockerId: string;
  blockerTitle: string;
  blockerCompletedAt: Date | null;
  blockerBoardId: string;
};

/** Last 20 notifications for the current user, newest first. Joined to
 *  card title + actor display name. Both read and unread. */
export async function listMyInbox(token: string): Promise<InboxItem[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        cardId: notifications.relatedCardId,
        cardTitle: cards.title,
        boardId: notifications.relatedBoardId,
        actorName: profiles.displayName,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .leftJoin(cards, eq(cards.id, notifications.relatedCardId))
      .leftJoin(profiles, eq(profiles.id, notifications.actorUserId))
      .orderBy(desc(notifications.createdAt))
      .limit(20);
    return rows as InboxItem[];
  });
}

/** Cards the current user explicitly watches (cardWatchers row exists).
 *  Sorted by most-recent activity timestamp desc. Limit 20. Skips
 *  archived cards. lastActivityAt = max(activity.createdAt) for that
 *  card or null. */
export async function listMyWatchlist(token: string): Promise<WatchedCard[]> {
  const userId = await meId(token);

  return dbAsUser(token, async (tx) => {
    // Build a subquery: max activity per card.
    const activitySub = tx
      .select({
        cardId: activity.cardId,
        lastActivityAt: max(activity.createdAt).as("last_activity_at"),
      })
      .from(activity)
      .groupBy(activity.cardId)
      .as("act_sub");

    const rows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        boardId: cards.boardId,
        boardTitle: boards.title,
        workspaceName: workspaces.name,
        completedAt: cards.completedAt,
        lastActivityAt: activitySub.lastActivityAt,
      })
      .from(cardWatchers)
      .innerJoin(cards, eq(cards.id, cardWatchers.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .leftJoin(activitySub, eq(activitySub.cardId, cards.id))
      .where(
        and(
          eq(cardWatchers.userId, userId),
          sql`${cards.archived} = false`,
        ),
      )
      .orderBy(desc(activitySub.lastActivityAt))
      .limit(20);

    return rows as WatchedCard[];
  });
}

/** Open cards (completedAt IS NULL) where the current user is the owner
 *  OR a card member, that have an is_blocked_by link FROM them. Returns
 *  one row per (myCard, blocker) pair. */
export async function listBlockersOnMyCards(
  token: string,
): Promise<BlockingMyCard[]> {
  const userId = await meId(token);

  return dbAsUser(token, async (tx) => {
    // Get my open cards (owner OR member).
    const myOwnerCards = tx
      .select({
        myCardId: cards.id,
        myCardTitle: cards.title,
        blockerId: cardLinks.toCardId,
      })
      .from(cards)
      .innerJoin(
        cardLinks,
        and(
          eq(cardLinks.fromCardId, cards.id),
          eq(cardLinks.kind, "is_blocked_by"),
        ),
      )
      .where(and(eq(cards.ownerId, userId), isNull(cards.completedAt)));

    const myMemberCards = tx
      .select({
        myCardId: cards.id,
        myCardTitle: cards.title,
        blockerId: cardLinks.toCardId,
      })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(
        cardLinks,
        and(
          eq(cardLinks.fromCardId, cards.id),
          eq(cardLinks.kind, "is_blocked_by"),
        ),
      )
      .where(and(eq(cardMembers.userId, userId), isNull(cards.completedAt)));

    // Union owner + member rows.
    const combined = myOwnerCards.union(myMemberCards).as("my_blocked_cards");

    const rows = await tx
      .select({
        myCardId: combined.myCardId,
        myCardTitle: combined.myCardTitle,
        blockerId: combined.blockerId,
        blockerTitle: cards.title,
        blockerCompletedAt: cards.completedAt,
        blockerBoardId: cards.boardId,
      })
      .from(combined)
      .innerJoin(cards, eq(cards.id, combined.blockerId))
      .orderBy(combined.myCardId, combined.blockerId);

    // Dedupe by (myCardId, blockerId).
    const seen = new Set<string>();
    const deduped: BlockingMyCard[] = [];
    for (const row of rows) {
      const key = `${row.myCardId}:${row.blockerId}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push({
          myCardId: row.myCardId,
          myCardTitle: row.myCardTitle,
          blockerId: row.blockerId,
          blockerTitle: row.blockerTitle,
          blockerCompletedAt: row.blockerCompletedAt,
          blockerBoardId: row.blockerBoardId,
        });
      }
    }
    return deduped;
  });
}
