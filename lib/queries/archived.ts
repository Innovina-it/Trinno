import { eq, and, desc, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, lists, boards } from "@/lib/db/schema";

export type ArchivedCardRow = {
  id: string;
  title: string;
  boardId: string;
  boardTitle: string;
  listId: string;
  listTitle: string;
  createdAt: Date;
};

export type ArchivedListRow = {
  id: string;
  title: string;
  boardId: string;
  boardTitle: string;
  createdAt: Date;
};

export type ArchivedBoardRow = {
  id: string;
  title: string;
  createdAt: Date;
};

export type WorkspaceArchive = {
  cards: ArchivedCardRow[];
  lists: ArchivedListRow[];
  boards: ArchivedBoardRow[];
};

/**
 * Plan #archive-page — fetch every archived item the caller can see in
 * this workspace. RLS-bound via dbAsUser; rows the user lacks access to
 * are simply absent. Sorted newest-first.
 */
export async function listWorkspaceArchive(
  token: string,
  workspaceId: string,
): Promise<WorkspaceArchive> {
  return dbAsUser(token, async (tx) => {
    // Boards in workspace (archived AND non-archived — we need the
    // titles for archived cards/lists that live on non-archived boards).
    const wsBoards = await tx
      .select({
        id: boards.id,
        title: boards.title,
        archived: boards.archived,
        createdAt: boards.createdAt,
        workspaceId: boards.workspaceId,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId));
    const boardById = new Map(wsBoards.map((b) => [b.id, b]));
    const boardIds = wsBoards.map((b) => b.id);

    if (boardIds.length === 0) {
      return { cards: [], lists: [], boards: [] };
    }

    // Lists in those boards (archived).
    const archivedLists = await tx
      .select({
        id: lists.id,
        title: lists.title,
        boardId: lists.boardId,
        createdAt: lists.createdAt,
      })
      .from(lists)
      .where(and(inArray(lists.boardId, boardIds), eq(lists.archived, true)))
      .orderBy(desc(lists.createdAt));

    const allLists = await tx
      .select({
        id: lists.id,
        title: lists.title,
        boardId: lists.boardId,
      })
      .from(lists)
      .where(inArray(lists.boardId, boardIds));
    const listById = new Map(allLists.map((l) => [l.id, l]));

    // Cards in those boards (archived).
    const archivedCards = await tx
      .select({
        id: cards.id,
        title: cards.title,
        boardId: cards.boardId,
        listId: cards.listId,
        createdAt: cards.createdAt,
      })
      .from(cards)
      .where(and(inArray(cards.boardId, boardIds), eq(cards.archived, true)))
      .orderBy(desc(cards.createdAt));

    const cardRows: ArchivedCardRow[] = archivedCards.map((c) => ({
      id: c.id,
      title: c.title,
      boardId: c.boardId,
      boardTitle: boardById.get(c.boardId)?.title ?? "(unknown)",
      listId: c.listId,
      listTitle: listById.get(c.listId)?.title ?? "(unknown)",
      createdAt: c.createdAt,
    }));

    const listRows: ArchivedListRow[] = archivedLists.map((l) => ({
      id: l.id,
      title: l.title,
      boardId: l.boardId,
      boardTitle: boardById.get(l.boardId)?.title ?? "(unknown)",
      createdAt: l.createdAt,
    }));

    const boardRows: ArchivedBoardRow[] = wsBoards
      .filter((b) => b.archived)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((b) => ({ id: b.id, title: b.title, createdAt: b.createdAt }));

    return { cards: cardRows, lists: listRows, boards: boardRows };
  });
}
