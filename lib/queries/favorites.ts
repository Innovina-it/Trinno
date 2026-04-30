import { desc, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boardFavorites,
  boards,
  workspaces,
} from "@/lib/db/schema";

export type FavoriteBoardRow = {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};

/**
 * Plan #16b-γ-C (#4) — list this user's favorited boards across every
 * workspace, with their workspace names so the nav dropdown can
 * disambiguate boards with the same title. RLS restricts the favorites
 * SELECT to the caller's rows; the inner joins on boards/workspaces are
 * additionally gated by their own RLS so a stale favorite (board the
 * user lost access to) silently drops out.
 */
export async function listFavoriteBoards(
  token: string,
): Promise<FavoriteBoardRow[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        boardId: boardFavorites.boardId,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
        workspaceName: workspaces.name,
        createdAt: boardFavorites.createdAt,
      })
      .from(boardFavorites)
      .innerJoin(boards, eq(boards.id, boardFavorites.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .orderBy(desc(boardFavorites.createdAt));
    return rows;
  });
}

export async function listFavoriteBoardIds(
  token: string,
): Promise<string[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({ boardId: boardFavorites.boardId })
      .from(boardFavorites);
    return rows.map((r) => r.boardId);
  });
}
