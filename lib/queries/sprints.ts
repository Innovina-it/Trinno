import { eq, desc, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, boards } from "@/lib/db/schema";

export async function listSprintsForWorkspace(
  token: string,
  workspaceId: string,
) {
  return dbAsUser(token, async (tx) =>
    tx
      .select()
      .from(sprints)
      .where(eq(sprints.workspaceId, workspaceId))
      .orderBy(desc(sprints.createdAt)),
  );
}

export async function listBacklogCards(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: cards.id,
        title: cards.title,
        listId: cards.listId,
        boardId: cards.boardId,
        boardTitle: boards.title,
        sprintId: cards.sprintId,
        type: cards.type,
        archived: cards.archived,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(eq(boards.workspaceId, workspaceId), eq(cards.archived, false)),
      ),
  );
}
