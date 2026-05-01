import { eq, asc, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, lists, workspaces } from "@/lib/db/schema";

/**
 * Plan #16b-γ-D — list every board+list pair the caller can write to.
 *
 * Used by the global quick-add dialog, cross-board move dialog, and the
 * cross-board card link picker. RLS gates SELECT on boards/lists to
 * those the user is a member of (or workspace-visible boards), so the
 * raw shape exposed here is whatever they can already see; the writer
 * RLS policies fail the actual mutation if they're not eligible to
 * write to the destination.
 */
export type BoardWithLists = {
  workspaceId: string;
  workspaceName: string;
  boardId: string;
  boardTitle: string;
  lists: { id: string; title: string }[];
};

export async function listBoardsWithLists(
  token: string,
): Promise<BoardWithLists[]> {
  return dbAsUser(token, async (tx) => {
    const boardRows = await tx
      .select({
        boardId: boards.id,
        boardTitle: boards.title,
        archived: boards.archived,
        workspaceId: boards.workspaceId,
        workspaceName: workspaces.name,
      })
      .from(boards)
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(eq(boards.archived, false))
      .orderBy(asc(workspaces.name), asc(boards.title));
    if (boardRows.length === 0) return [];

    const listRows = await tx
      .select({
        id: lists.id,
        title: lists.title,
        boardId: lists.boardId,
        position: lists.position,
      })
      .from(lists)
      .where(eq(lists.archived, false))
      .orderBy(asc(lists.position));

    const listsByBoard = new Map<string, { id: string; title: string }[]>();
    for (const r of listRows) {
      if (!listsByBoard.has(r.boardId)) listsByBoard.set(r.boardId, []);
      listsByBoard.get(r.boardId)!.push({ id: r.id, title: r.title });
    }

    return boardRows.map((b) => ({
      workspaceId: b.workspaceId,
      workspaceName: b.workspaceName,
      boardId: b.boardId,
      boardTitle: b.boardTitle,
      lists: listsByBoard.get(b.boardId) ?? [],
    }));
  });
}
