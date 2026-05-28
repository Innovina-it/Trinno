// Panel A query helpers for the /me home dashboard.
// All queries are RLS-scoped via dbAsUser so each user sees only their
// own boards. This file deliberately avoids a mega-query so each
// panel can evolve independently.

import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { meId } from "@/lib/queries/me";
import { listMyGuestWorkspaceIds } from "@/lib/queries/me-guard";
import {
  boards,
  cardMembers,
  cards,
  lists,
  workspaces,
} from "@/lib/db/schema";

export type MyCard = {
  id: string;
  title: string;
  type: string;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
  dueDate: Date | null;
  startDate: Date | null;
  targetDate: Date | null;
  completedAt: Date | null;
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  statusKind: "todo" | "in_progress" | "review" | "done" | "blocked" | null;
  role: "owner" | "member";
};

const MAX_OPEN_CARDS = 200;
const MAX_TODAY_RAW = 1000;

/** Returns open (non-archived, not completed) cards where the authed user
 *  is the owner OR a card member. Deduped so a card surfaces once,
 *  preferring role="owner". */
export async function listMyOpenCards(token: string): Promise<MyCard[]> {
  const userId = await meId(token);
  const guestWsIds = await listMyGuestWorkspaceIds(token, userId);
  const excludeGuest =
    guestWsIds.length > 0
      ? notInArray(boards.workspaceId, guestWsIds)
      : undefined;

  return dbAsUser(token, async (tx) => {
    const baseSelect = {
      id: cards.id,
      title: cards.title,
      type: cards.type,
      boardId: cards.boardId,
      boardTitle: boards.title,
      workspaceId: boards.workspaceId,
      workspaceName: workspaces.name,
      dueDate: cards.dueDate,
      startDate: cards.startDate,
      targetDate: cards.targetDate,
      completedAt: cards.completedAt,
      priority: cards.priority,
      statusKind: lists.statusKind,
    };

    const ownerRows = await tx
      .select(baseSelect)
      .from(cards)
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNull(cards.completedAt),
          eq(cards.ownerId, userId),
          excludeGuest,
        ),
      )
      .orderBy(asc(cards.createdAt))
      .limit(MAX_OPEN_CARDS);

    const memberRows = await tx
      .select(baseSelect)
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(
        and(
          eq(cards.archived, false),
          isNull(cards.completedAt),
          eq(cardMembers.userId, userId),
          excludeGuest,
        ),
      )
      .orderBy(asc(cards.createdAt))
      .limit(MAX_OPEN_CARDS);

    // Dedupe: owner wins over member for the same card.
    const ownerCardIds = new Set(ownerRows.map((r) => r.id));

    const toCard = (
      r: (typeof ownerRows)[number],
      role: "owner" | "member",
    ): MyCard => ({
      id: r.id,
      title: r.title,
      type: r.type,
      boardId: r.boardId,
      boardTitle: r.boardTitle,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      dueDate: (r.dueDate ?? null) as Date | null,
      startDate: (r.startDate ?? null) as Date | null,
      targetDate: (r.targetDate ?? null) as Date | null,
      completedAt: (r.completedAt ?? null) as Date | null,
      priority: (r.priority ?? null) as MyCard["priority"],
      statusKind: (r.statusKind ?? null) as MyCard["statusKind"],
      role,
    });

    const out: MyCard[] = ownerRows.map((r) => toCard(r, "owner"));
    for (const r of memberRows) {
      if (ownerCardIds.has(r.id)) continue;
      out.push(toCard(r, "member"));
    }

    return out.slice(0, MAX_OPEN_CARDS);
  });
}

/** Counts overdue / due-today / completed-today cards for the current user. */
export async function getMyTodayCounts(
  token: string,
): Promise<{ overdue: number; dueToday: number; completedToday: number }> {
  const userId = await meId(token);
  const guestWsIds = await listMyGuestWorkspaceIds(token, userId);

  return dbAsUser(token, async (tx) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Fetch raw rows for this user (owner or member), not archived.
    // Join boards so we can exclude guest workspaces from the count.
    const excludeGuest =
      guestWsIds.length > 0
        ? notInArray(boards.workspaceId, guestWsIds)
        : undefined;

    const ownerRows = await tx
      .select({
        id: cards.id,
        dueDate: cards.dueDate,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(
          eq(cards.archived, false),
          eq(cards.ownerId, userId),
          excludeGuest,
        ),
      )
      .limit(MAX_TODAY_RAW);

    const memberRows = await tx
      .select({
        id: cards.id,
        dueDate: cards.dueDate,
        completedAt: cards.completedAt,
      })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(
          eq(cards.archived, false),
          eq(cardMembers.userId, userId),
          excludeGuest,
        ),
      )
      .limit(MAX_TODAY_RAW);

    // Dedupe by card id; owner wins.
    const ownerCardIds = new Set(ownerRows.map((r) => r.id));
    const allRows = [
      ...ownerRows,
      ...memberRows.filter((r) => !ownerCardIds.has(r.id)),
    ];

    let overdue = 0;
    let dueToday = 0;
    let completedToday = 0;

    for (const r of allRows) {
      const due = r.dueDate ? new Date(r.dueDate) : null;
      const completed = r.completedAt ? new Date(r.completedAt) : null;

      if (completed && completed >= startOfToday) {
        completedToday++;
      }
      if (!completed && due) {
        if (due < startOfToday) {
          overdue++;
        } else if (due <= endOfToday) {
          dueToday++;
        }
      }
    }

    return { overdue, dueToday, completedToday };
  });
}
