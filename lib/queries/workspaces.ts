import { eq, desc, and, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  boards,
  profiles,
} from "@/lib/db/schema";

// Returns the caller's role in the given workspace, or null if not a member.
// Used by UI to gate admin-only entry points (e.g. "New board") and by
// server actions to short-circuit RLS-violation 500s with a friendlier error.
export async function getWorkspaceRole(
  token: string,
  workspaceId: string,
  userId: string,
): Promise<"owner" | "admin" | "member" | null> {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    return (row?.role as "owner" | "admin" | "member" | undefined) ?? null;
  });
}

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
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        pendingId: workspaceInvitations.id,
      })
      .from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .leftJoin(
        workspaceInvitations,
        and(
          eq(workspaceInvitations.workspaceId, workspaceMembers.workspaceId),
          eq(workspaceInvitations.userId, workspaceMembers.userId),
          eq(workspaceInvitations.status, "pending"),
        ),
      )
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows.map(({ pendingId, ...m }) => ({ ...m, pending: pendingId !== null }));
  });
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
        parentBoardId: boards.parentBoardId,
        position: boards.position,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId))
      .orderBy(asc(boards.position), desc(boards.createdAt)),
  );
}

