import { cache } from "react";
import { eq, inArray, asc, desc, and, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import type { WorkspaceRole } from "@/lib/permissions/guest-guard";
import type { CardUrlLink } from "@/lib/links/types";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";
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
  links,
  cardMembers,
  profiles,
  workspaceMembers,
  workspaces,
  roadmapBaselines,
} from "@/lib/db/schema";
import type { BaselineMeta } from "@/lib/baselines/types";

// Plan #16b-β — single-transaction snapshot loader for the per-workspace
// store. Loads all readable boards in the workspace, plus the cards / sprints
// / components / versions / card_versions / card_links / member profiles that
// the per-workspace Roadmap, Backlog, and Dashboard views consume. Routed
// through `dbAsUser` so RLS policies filter every table to rows the caller
// can see.

export type WorkspaceSnapshot = {
  workspaceId: string;
  // Plan #links — the requesting user's id and their workspace_members.role
  // for THIS workspace (null if not a member, e.g. service paths). The client
  // store exposes these so UI can gate owner/admin-only affordances (link
  // writes) without a server round-trip. Derived server-side from auth.uid()
  // within the RLS-scoped transaction.
  viewerId: string;
  viewerRole: WorkspaceRole;
  // Per-workspace toggle: when true, the server-side createCard path
  // auto-inserts the creator into card_members. The client mirrors this
  // by seeding the assignee picker in the new-card dialog so the UI
  // matches what the server will persist.
  autoAssignCreator: boolean;
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
    // Plan #aggregate-kanban — fractional-indexing position; aggregate
    // kanban view sorts by this to pick the visually-first matching list
    // per board for cross-status drops.
    position: string;
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
    // Plan #aggregate-kanban — fractional-indexing position used to
    // append a card to the end of a target list when dragged across
    // status columns in the workspace-aggregate view.
    position: string;
    // Plan #16b-γ-G G1 — manual roadmap row order. NULL = unranked.
    roadmapOrder: number | null;
    // Plan #16b-γ-G G4 — priority enum (P0-P4). NULL = unset.
    priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
    ownerId: string | null;
    completedAt: Date | null;
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
  cardMembers: Array<{ cardId: string; userId: string }>;
  workspaceProfiles: Array<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
  // Sub-boards in the workspace, keyed by anchor card via boards.parent_card_id
  // (migration 0105). Consumed by the roadmap's `groupBySubBoard` to build
  // sub-board lanes whose header is the anchor card.
  subBoards: Array<{ id: string; title: string; parentCardId: string | null }>;
  // Plan #links — URL links keyed by card id, scoped to this workspace
  // (scope='card'). Seeds the per-card link diamond on first SSR paint so
  // existing links are visible without an in-session write. Optional so
  // legacy snapshot fixtures that construct this literal stay valid; the
  // store defaults it to {}.
  cardLinkByCard?: Record<string, CardUrlLink>;
  // Baseline metadata for the Baselines menu in the roadmap toolbar.
  // Optional so legacy snapshot fixtures stay valid; the store defaults it to [].
  baselines?: BaselineMeta[];
};

export const getWorkspaceSnapshot = cache(async function getWorkspaceSnapshot(
  token: string,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  return dbAsUser(token, async (tx) => {
    const [wsRow] = await tx
      .select({ autoAssignCreator: workspaces.autoAssignCreator })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const autoAssignCreator = wsRow?.autoAssignCreator ?? false;

    // The requesting user's id and workspace role. auth.uid() reads the JWT
    // claims already bound to this RLS-scoped transaction by dbAsUser, so it
    // is the authoritative viewer identity. The role lookup is membership in
    // THIS workspace (null when the caller is not a member).
    const uidRows = (await tx.execute(
      sql`select auth.uid()::text as uid`,
    )) as unknown as Array<{ uid: string | null }>;
    const viewerId = uidRows[0]?.uid ?? "";
    const [roleRow] = viewerId
      ? await tx
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, viewerId),
            ),
          )
          .limit(1)
      : [];
    const viewerRole: WorkspaceRole =
      (roleRow?.role as WorkspaceRole | undefined) ?? null;

    const boardRows = await tx
      .select({
        id: boards.id,
        title: boards.title,
        archived: boards.archived,
        backgroundKind: boards.backgroundKind,
        backgroundValue: boards.backgroundValue,
        parentCardId: boards.parentCardId,
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
              .select({
                id: profiles.id,
                displayName: profiles.displayName,
                avatarUrl: profiles.avatarUrl,
              })
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
      const baselineRowsShort = await tx
        .select()
        .from(roadmapBaselines)
        .where(eq(roadmapBaselines.workspaceId, workspaceId))
        .orderBy(desc(roadmapBaselines.createdAt));
      const baselines: BaselineMeta[] = baselineRowsShort.map((b) => ({
        id: b.id,
        workspaceId: b.workspaceId,
        name: b.name,
        note: b.note,
        createdBy: b.createdBy,
        createdAt: b.createdAt.toISOString(),
        isApproved: b.isApproved,
      }));
      return {
        workspaceId,
        viewerId,
        viewerRole,
        autoAssignCreator,
        boards: [],
        lists: [],
        cards: [],
        sprints: sprintRows,
        components: [],
        cardComponents: [],
        versions: versionRows,
        cardVersions: [],
        cardLinks: [],
        cardMembers: [],
        workspaceProfiles: profileRows,
        subBoards: [],
        cardLinkByCard: {},
        baselines,
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
      cardMemberRows,
      memberRows,
      urlLinkRows,
    ] = await Promise.all([
      tx
        .select({
          id: lists.id,
          boardId: lists.boardId,
          title: lists.title,
          position: lists.position,
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
          position: cards.position,
          roadmapOrder: cards.roadmapOrder,
          priority: cards.priority,
          ownerId: cards.ownerId,
          completedAt: cards.completedAt,
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
        .select({ cardId: cardMembers.cardId, userId: cardMembers.userId })
        .from(cardMembers)
        .where(inArray(cardMembers.boardId, boardIds)),

      tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),

      tx
        .select({
          id: links.id,
          cardId: links.cardId,
          url: links.url,
          color: links.color,
        })
        .from(links)
        .where(and(eq(links.scope, "card"), eq(links.workspaceId, workspaceId))),
    ]);

    // Shape card-scope URL links into a card-id-keyed map (see type doc).
    const cardLinkByCard: Record<string, CardUrlLink> = Object.fromEntries(
      urlLinkRows
        .filter((r) => r.cardId)
        .map((r) => [
          r.cardId as string,
          {
            id: r.id,
            cardId: r.cardId as string,
            url: r.url,
            color: r.color ?? DEFAULT_LINK_COLOR,
          },
        ]),
    );

    const profileRows =
      memberRows.length === 0
        ? []
        : await tx
            .select({
              id: profiles.id,
              displayName: profiles.displayName,
              avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(
              inArray(
                profiles.id,
                memberRows.map((m) => m.userId),
              ),
            );

    // Sub-boards = boards in the workspace with a non-null parent_card_id
    // (card→sub-board anchor link from migration 0105). The roadmap consumes
    // this to build lanes whose header is the anchor card.
    const subBoardRefs = boardRows
      .filter((b) => b.parentCardId !== null)
      .map((b) => ({
        id: b.id,
        title: b.title,
        parentCardId: b.parentCardId,
      }));

    const baselineRows = await tx
      .select()
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.workspaceId, workspaceId))
      .orderBy(desc(roadmapBaselines.createdAt));
    const baselines: BaselineMeta[] = baselineRows.map((b) => ({
      id: b.id,
      workspaceId: b.workspaceId,
      name: b.name,
      note: b.note,
      createdBy: b.createdBy,
      createdAt: b.createdAt.toISOString(),
      isApproved: b.isApproved,
    }));

    return {
      workspaceId,
      viewerId,
      viewerRole,
      autoAssignCreator,
      boards: boardRows.map((b) => ({
        id: b.id,
        title: b.title,
        archived: b.archived,
        backgroundKind: b.backgroundKind,
        backgroundValue: b.backgroundValue,
      })),
      lists: listRows,
      cards: cardRows,
      sprints: sprintRows,
      components: componentRows,
      cardComponents: cardComponentRows,
      versions: versionRows,
      cardVersions: cardVersionRows,
      cardLinks: cardLinkRows,
      cardMembers: cardMemberRows,
      workspaceProfiles: profileRows,
      subBoards: subBoardRefs,
      cardLinkByCard,
      baselines,
    };
  });
});
