import { cache } from "react";
import { eq, inArray, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boards,
  cards,
  lists,
  sprints,
  components,
  versions,
  cardComponents,
  cardVersions,
  cardLinks,
  profiles,
  workspaceMembers,
} from "@/lib/db/schema";

// Plan #16b-β — single-transaction snapshot loader for the per-workspace
// store. Loads all readable boards in the workspace, plus the cards / sprints
// / components / versions / card_versions / card_links / member profiles that
// the per-workspace Roadmap, Backlog, and Dashboard views consume. Routed
// through `dbAsUser` so RLS policies filter every table to rows the caller
// can see.

export type WorkspaceSnapshot = {
  workspaceId: string;
  boards: Array<{
    id: string;
    title: string;
    archived: boolean;
    backgroundKind: string;
    backgroundValue: string;
  }>;
  lists: Array<{
    id: string;
    boardId: string;
    title: string;
    statusKind:
      | "todo"
      | "in_progress"
      | "review"
      | "done"
      | "blocked"
      | null;
  }>;
  cards: Array<{
    id: string;
    boardId: string;
    listId: string;
    title: string;
    description: string | null;
    type: string;
    parentCardId: string | null;
    sprintId: string | null;
    storyPoints: number | null;
    startDate: Date | null;
    targetDate: Date | null;
    dueDate: Date | null;
    dueComplete: boolean;
    archived: boolean;
    createdAt: Date;
  }>;
  sprints: Array<{
    id: string;
    name: string;
    goal: string | null;
    startDate: Date | null;
    endDate: Date | null;
    state: string;
  }>;
  components: Array<{ id: string; boardId: string; name: string }>;
  cardComponents: Array<{ cardId: string; componentId: string }>;
  versions: Array<{
    id: string;
    name: string;
    semver: string | null;
    state: string;
    releaseDate: Date | null;
  }>;
  cardVersions: Array<{ cardId: string; versionId: string; kind: string }>;
  cardLinks: Array<{
    id: string;
    fromCardId: string;
    toCardId: string;
    kind: string;
    boardId: string;
  }>;
  workspaceProfiles: Array<{ id: string; displayName: string }>;
};

export const getWorkspaceSnapshot = cache(async function getWorkspaceSnapshot(
  token: string,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  return dbAsUser(token, async (tx) => {
    const boardRows = await tx
      .select({
        id: boards.id,
        title: boards.title,
        archived: boards.archived,
        backgroundKind: boards.backgroundKind,
        backgroundValue: boards.backgroundValue,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId));

    if (boardRows.length === 0) {
      // Guard: drizzle's `inArray(..., [])` throws — short-circuit here.
      const memberRows = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      const profileRows =
        memberRows.length === 0
          ? []
          : await tx
              .select({ id: profiles.id, displayName: profiles.displayName })
              .from(profiles)
              .where(
                inArray(
                  profiles.id,
                  memberRows.map((m) => m.userId),
                ),
              );
      const sprintRows = await tx
        .select({
          id: sprints.id,
          name: sprints.name,
          goal: sprints.goal,
          startDate: sprints.startDate,
          endDate: sprints.endDate,
          state: sprints.state,
        })
        .from(sprints)
        .where(eq(sprints.workspaceId, workspaceId))
        .orderBy(asc(sprints.startDate));
      const versionRows = await tx
        .select({
          id: versions.id,
          name: versions.name,
          semver: versions.semver,
          state: versions.state,
          releaseDate: versions.releaseDate,
        })
        .from(versions)
        .where(eq(versions.workspaceId, workspaceId))
        .orderBy(asc(versions.name));
      return {
        workspaceId,
        boards: [],
        lists: [],
        cards: [],
        sprints: sprintRows,
        components: [],
        cardComponents: [],
        versions: versionRows,
        cardVersions: [],
        cardLinks: [],
        workspaceProfiles: profileRows,
      };
    }

    const boardIds = boardRows.map((b) => b.id);

    const [
      listRows,
      cardRows,
      sprintRows,
      componentRows,
      cardComponentRows,
      versionRows,
      cardVersionRows,
      cardLinkRows,
      memberRows,
    ] = await Promise.all([
      tx
        .select({
          id: lists.id,
          boardId: lists.boardId,
          title: lists.title,
          statusKind: lists.statusKind,
        })
        .from(lists)
        .where(inArray(lists.boardId, boardIds)),
      tx
        .select({
          id: cards.id,
          boardId: cards.boardId,
          listId: cards.listId,
          title: cards.title,
          description: cards.description,
          type: cards.type,
          parentCardId: cards.parentCardId,
          sprintId: cards.sprintId,
          storyPoints: cards.storyPoints,
          startDate: cards.startDate,
          targetDate: cards.targetDate,
          dueDate: cards.dueDate,
          dueComplete: cards.dueComplete,
          archived: cards.archived,
          createdAt: cards.createdAt,
        })
        .from(cards)
        .where(inArray(cards.boardId, boardIds)),

      tx
        .select({
          id: sprints.id,
          name: sprints.name,
          goal: sprints.goal,
          startDate: sprints.startDate,
          endDate: sprints.endDate,
          state: sprints.state,
        })
        .from(sprints)
        .where(eq(sprints.workspaceId, workspaceId))
        .orderBy(asc(sprints.startDate)),

      tx
        .select({
          id: components.id,
          boardId: components.boardId,
          name: components.name,
        })
        .from(components)
        .where(inArray(components.boardId, boardIds)),

      tx
        .select({
          cardId: cardComponents.cardId,
          componentId: cardComponents.componentId,
        })
        .from(cardComponents)
        .where(inArray(cardComponents.boardId, boardIds)),

      tx
        .select({
          id: versions.id,
          name: versions.name,
          semver: versions.semver,
          state: versions.state,
          releaseDate: versions.releaseDate,
        })
        .from(versions)
        .where(eq(versions.workspaceId, workspaceId))
        .orderBy(asc(versions.name)),

      tx
        .select({
          cardId: cardVersions.cardId,
          versionId: cardVersions.versionId,
          kind: cardVersions.kind,
        })
        .from(cardVersions)
        .where(eq(cardVersions.workspaceId, workspaceId)),

      tx
        .select({
          id: cardLinks.id,
          fromCardId: cardLinks.fromCardId,
          toCardId: cardLinks.toCardId,
          kind: cardLinks.kind,
          boardId: cardLinks.boardId,
        })
        .from(cardLinks)
        .where(inArray(cardLinks.boardId, boardIds)),

      tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
    ]);

    const profileRows =
      memberRows.length === 0
        ? []
        : await tx
            .select({ id: profiles.id, displayName: profiles.displayName })
            .from(profiles)
            .where(
              inArray(
                profiles.id,
                memberRows.map((m) => m.userId),
              ),
            );

    return {
      workspaceId,
      boards: boardRows,
      lists: listRows,
      cards: cardRows,
      sprints: sprintRows,
      components: componentRows,
      cardComponents: cardComponentRows,
      versions: versionRows,
      cardVersions: cardVersionRows,
      cardLinks: cardLinkRows,
      workspaceProfiles: profileRows,
    };
  });
});
