import { eq, and, desc, isNull, sql, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  notifications,
  cards,
  boards,
  profiles,
  cardWatchers,
} from "@/lib/db/schema";

export type NotificationRow = {
  id: string;
  kind: string;
  payload: unknown;
  relatedCardId: string | null;
  relatedBoardId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
  cardTitle: string | null;
  boardTitle: string | null;
  workspaceId: string | null;
};

export async function listNotifications(
  token: string,
  opts: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
    kinds?: string[];
  } = {},
): Promise<NotificationRow[]> {
  const { limit = 50, offset = 0, unreadOnly, kinds } = opts;
  return dbAsUser(token, async (tx) => {
    const where = and(
      unreadOnly ? isNull(notifications.readAt) : sql`true`,
      kinds && kinds.length
        ? inArray(notifications.kind, kinds)
        : sql`true`,
    );
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        payload: notifications.payload,
        relatedCardId: notifications.relatedCardId,
        relatedBoardId: notifications.relatedBoardId,
        actorUserId: notifications.actorUserId,
        actorName: profiles.displayName,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        cardTitle: cards.title,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
      })
      .from(notifications)
      .leftJoin(profiles, eq(profiles.id, notifications.actorUserId))
      .leftJoin(cards, eq(cards.id, notifications.relatedCardId))
      .leftJoin(boards, eq(boards.id, notifications.relatedBoardId))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
    return rows as unknown as NotificationRow[];
  });
}

// Total notifications matching a filter (NOT capped by the list's page
// limit) so the Inbox can show "X of Y" and decide whether more exist.
// Mirrors listNotifications' WHERE exactly; RLS scopes visibility the same.
export async function countNotifications(
  token: string,
  opts: { unreadOnly?: boolean; kinds?: string[] } = {},
): Promise<number> {
  const { unreadOnly, kinds } = opts;
  return dbAsUser(token, async (tx) => {
    const where = and(
      unreadOnly ? isNull(notifications.readAt) : sql`true`,
      kinds && kinds.length
        ? inArray(notifications.kind, kinds)
        : sql`true`,
    );
    const [row] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(where);
    return row?.c ?? 0;
  });
}

export async function unreadCount(token: string): Promise<number> {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(isNull(notifications.readAt));
    return row?.c ?? 0;
  });
}

export async function isWatchingCard(
  token: string,
  cardId: string,
  userId: string,
): Promise<boolean> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select()
      .from(cardWatchers)
      .where(
        and(
          eq(cardWatchers.cardId, cardId),
          eq(cardWatchers.userId, userId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}

export type CardWatcherRow = {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  auto: boolean;
  createdAt: Date;
};

export async function listCardWatchers(
  token: string,
  cardId: string,
): Promise<CardWatcherRow[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        userId: cardWatchers.userId,
        displayName: profiles.displayName,
        handle: profiles.handle,
        avatarUrl: profiles.avatarUrl,
        auto: cardWatchers.auto,
        createdAt: cardWatchers.createdAt,
      })
      .from(cardWatchers)
      .innerJoin(profiles, eq(profiles.id, cardWatchers.userId))
      .where(eq(cardWatchers.cardId, cardId))
      .orderBy(cardWatchers.createdAt);
    return rows;
  });
}
