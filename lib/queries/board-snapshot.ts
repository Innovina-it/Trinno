import { eq, asc, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, lists, cards } from "@/lib/db/schema";

export type BoardRow = typeof boards.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type CardRow = typeof cards.$inferSelect;

export type BoardSnapshot = {
  board: BoardRow;
  lists: ListRow[];
  cards: CardRow[];
};

export async function getBoardSnapshot(
  token: string,
  boardId: string,
): Promise<BoardSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const [board] = await tx
      .select()
      .from(boards)
      .where(eq(boards.id, boardId));
    if (!board) return null;

    const [listRows, cardRows] = await Promise.all([
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, boardId), eq(lists.archived, false)))
        .orderBy(asc(lists.position)),
      tx
        .select()
        .from(cards)
        .where(and(eq(cards.boardId, boardId), eq(cards.archived, false)))
        .orderBy(asc(cards.position)),
    ]);

    return { board, lists: listRows, cards: cardRows };
  });
}
