import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  workspaces,
  workspaceMembers,
  boards,
  profiles,
} from "@/lib/db/schema";

export async function listWorkspaces(token: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt)),
  );
}

export async function getWorkspace(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id));
    return row ?? null;
  });
}

export async function listBoardMembersFor(token: string, boardId: string) {
  const { dbAsUser: _ } = await import("@/lib/db/client");
  const { boardMembers, profiles } = await import("@/lib/db/schema");
  return _(token, async (tx) =>
    tx
      .select({
        userId: boardMembers.userId,
        role: boardMembers.role,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(boardMembers)
      .innerJoin(profiles, eq(profiles.id, boardMembers.userId))
      .where(eq(boardMembers.boardId, boardId)),
  );
}

export async function listMembers(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
  );
}

export async function listBoardsInWorkspace(
  token: string,
  workspaceId: string,
) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: boards.id,
        title: boards.title,
        backgroundKind: boards.backgroundKind,
        backgroundValue: boards.backgroundValue,
        archived: boards.archived,
        createdAt: boards.createdAt,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId))
      .orderBy(desc(boards.createdAt)),
  );
}

export type EpicTile = {
  id: string;
  title: string;
  boardId: string;
  archived: boolean;
};

export async function listEpicsInWorkspace(
  token: string,
  workspaceId: string,
): Promise<EpicTile[]> {
  const { cards } = await import("@/lib/db/schema");
  const { and, eq: eqOp, inArray } = await import("drizzle-orm");
  return dbAsUser(token, async (tx) => {
    // First get all board ids in this workspace.
    const boardRows = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId));
    if (boardRows.length === 0) return [];
    const boardIds = boardRows.map((b) => b.id);

    const rows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        boardId: cards.boardId,
        archived: cards.archived,
      })
      .from(cards)
      .where(
        and(
          inArray(cards.boardId, boardIds),
          eqOp(cards.type, "epic"),
        ),
      )
      .orderBy(desc(cards.id));
    return rows;
  });
}
