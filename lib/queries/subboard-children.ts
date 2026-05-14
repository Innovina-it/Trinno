import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, cards, lists } from "@/lib/db/schema";

export type SubboardCardRow = typeof cards.$inferSelect;
export type SubboardListRow = typeof lists.$inferSelect;
export type SubboardRow = typeof boards.$inferSelect;

export type SubboardSnapshot = {
  subboard: SubboardRow;
  children: SubboardCardRow[];
  lists: SubboardListRow[];
};

/**
 * Server-side fetch for a sub-board page. Returns the sub-board, its
 * top-level cards, and all lists on that sub-board. Returns null when
 * the id does not resolve to a visible child board.
 */
export async function listSubboardChildren(
  token: string,
  subboardId: string,
): Promise<SubboardSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const [subboard] = await tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, subboardId), isNotNull(boards.parentBoardId)));
    if (!subboard) return null;

    const children = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.boardId, subboardId), isNull(cards.parentCardId)));

    const boardLists = await tx
      .select()
      .from(lists)
      .where(eq(lists.boardId, subboardId));

    return { subboard, children, lists: boardLists };
  });
}
