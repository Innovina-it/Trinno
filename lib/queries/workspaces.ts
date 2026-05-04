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
