import { eq, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, lists, cards } from "@/lib/db/schema";

export type BoardSnapshot = {
  board: {
    id: string;
    title: string;
    backgroundKind: string;
    backgroundValue: string;
    workspaceId: string;
    archived: boolean;
  };
  lists: Array<{
    id: string;
    title: string;
    position: string;
    archived: boolean;
  }>;
  cards: Array<{
    id: string;
    listId: string;
    title: string;
    description: string | null;
    position: string;
    archived: boolean;
  }>;
};

export async function getBoardSnapshot(
  token: string,
  boardId: string,
): Promise<BoardSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const [b] = await tx.select().from(boards).where(eq(boards.id, boardId));
    if (!b) return null;
    const ls = await tx
      .select({
        id: lists.id,
        title: lists.title,
        position: lists.position,
        archived: lists.archived,
      })
      .from(lists)
      .where(eq(lists.boardId, boardId))
      .orderBy(asc(lists.position));
    const cs = await tx
      .select({
        id: cards.id,
        listId: cards.listId,
        title: cards.title,
        description: cards.description,
        position: cards.position,
        archived: cards.archived,
      })
      .from(cards)
      .where(eq(cards.boardId, boardId))
      .orderBy(asc(cards.position));
    return {
      board: {
        id: b.id,
        title: b.title,
        backgroundKind: b.backgroundKind,
        backgroundValue: b.backgroundValue,
        workspaceId: b.workspaceId,
        archived: b.archived,
      },
      lists: ls,
      cards: cs,
    };
  });
}
