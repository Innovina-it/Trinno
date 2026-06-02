import { cache } from "react";
import { eq, asc, and, inArray, isNotNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boards,
  lists,
  cards,
  labels,
  cardLabels,
  cardMembers,
  checklists,
  checklistItems,
  comments,
  attachments,
  boardMembers,
  workspaceMembers,
  profiles,
  cardLinks,
  links,
  components,
  cardComponents,
  cardVersions,
} from "@/lib/db/schema";
import type { CardUrlLink } from "@/lib/links/types";

export type BoardRow = typeof boards.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
export type CardLabelRow = { cardId: string; labelId: string };
export type CardMemberRow = { cardId: string; userId: string };
export type ChecklistRow = typeof checklists.$inferSelect;
export type ChecklistItemRow = typeof checklistItems.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type CardLinkRow = typeof cardLinks.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type CardComponentRow = typeof cardComponents.$inferSelect;
export type CardVersionRow = typeof cardVersions.$inferSelect;
export type BoardProfile = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};
export type BoardMemberRole = {
  userId: string;
  role: "admin" | "member" | "observer";
};

// Sub-board pointer surfaced on the parent board snapshot. One row per
// child board with parent_card_id set (1:1 with the anchor card). The
// kanban tile uses this to render a "drill into sub-board" affordance.
export type CardSubboardRow = {
  cardId: string;
  subBoardId: string;
  title: string;
};

export type BoardSnapshot = {
  board: BoardRow;
  lists: ListRow[];
  cards: CardRow[];
  labels: LabelRow[];
  cardLabels: CardLabelRow[];
  cardMembers: CardMemberRow[];
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
  comments: CommentRow[];
  attachments: AttachmentRow[];
  cardLinks: CardLinkRow[];
  components: ComponentRow[];
  cardComponents: CardComponentRow[];
  cardVersions: CardVersionRow[];
  boardProfiles: BoardProfile[];
  boardMembers: BoardMemberRole[];
  workspaceProfiles: BoardProfile[];
  cardSubboards: CardSubboardRow[];
  // Plan #links — URL links keyed by card id, scoped to this board's
  // workspace (scope='card'). Seeds the per-card link diamond on first
  // SSR paint so existing links are visible without an in-session write.
  cardLinkByCard: Record<string, CardUrlLink>;
};

async function listCommentsCompat(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  boardId: string,
): Promise<CommentRow[]> {
  const rows = await tx.execute(sql`
    select
      c.id,
      c.card_id,
      c.board_id,
      c.author_id,
      nullif(to_jsonb(c)->>'parent_comment_id', '')::uuid as parent_comment_id,
      c.body,
      c.created_at,
      c.edited_at,
      nullif(to_jsonb(c)->>'resolved_at', '')::timestamptz as resolved_at,
      nullif(to_jsonb(c)->>'resolved_by', '')::uuid as resolved_by
    from public.comments c
    where c.board_id = ${boardId}
    order by c.created_at asc
  `);
  return (rows as unknown as Array<{
    id: string;
    card_id: string;
    board_id: string;
    author_id: string;
    parent_comment_id: string | null;
    body: string;
    created_at: Date | string;
    edited_at: Date | string | null;
    resolved_at: Date | string | null;
    resolved_by: string | null;
  }>).map((r) => ({
    id: r.id,
    cardId: r.card_id,
    boardId: r.board_id,
    authorId: r.author_id,
    parentCommentId: r.parent_comment_id ?? null,
    body: r.body,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    editedAt: r.edited_at
      ? r.edited_at instanceof Date
        ? r.edited_at
        : new Date(r.edited_at)
      : null,
    resolvedAt: r.resolved_at
      ? r.resolved_at instanceof Date
        ? r.resolved_at
        : new Date(r.resolved_at)
      : null,
    resolvedBy: r.resolved_by ?? null,
  }));
}

// React `cache` dedupes invocations within a single request. Multiple
// consumers (layout, page, sibling fetches) can call `getBoardSnapshot`
// with the same (token, boardId) tuple and share one in-flight promise
// instead of re-running 14 RLS-bound queries. Mirrors the pattern used
// by `getWorkspaceSnapshot` in workspace-snapshot.ts:107.
// RFC 4122 UUID shape. Cheap guard against malformed path params
// (e.g. "63a12...easda") that would otherwise hit Postgres and raise
// SQLSTATE 22P02 / `invalid input syntax for type uuid`, surfacing as
// a 500 instead of the page's `notFound()` path.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getBoardSnapshot = cache(async function getBoardSnapshot(
  token: string,
  boardId: string,
): Promise<BoardSnapshot | null> {
  if (!UUID_RE.test(boardId)) return null;
  return dbAsUser(token, async (tx) => {
    const [board] = await tx
      .select()
      .from(boards)
      .where(eq(boards.id, boardId));
    if (!board) return null;

    const [
      listRows,
      cardRows,
      labelRows,
      cardLabelRows,
      cardMemberRows,
      checklistRows,
      checklistItemRows,
      commentRows,
      attachmentRows,
      cardLinkRows,
      memberRows,
      componentRows,
      cardComponentRows,
      cardVersionRows,
      workspaceMemberRows,
      subBoardRows,
      linkRows,
    ] = await Promise.all([
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, boardId), eq(lists.archived, false)))
        .orderBy(asc(lists.position)),
      tx
        .select()
        .from(cards)
        .where(and(eq(cards.boardId, boardId), eq(cards.archived, false)))
        .orderBy(asc(cards.position)),
      tx.select().from(labels).where(eq(labels.boardId, boardId)),
      tx
        .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
        .from(cardLabels)
        .where(eq(cardLabels.boardId, boardId)),
      tx
        .select({ cardId: cardMembers.cardId, userId: cardMembers.userId })
        .from(cardMembers)
        .where(eq(cardMembers.boardId, boardId)),
      tx
        .select()
        .from(checklists)
        .where(eq(checklists.boardId, boardId))
        .orderBy(asc(checklists.position)),
      tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.boardId, boardId))
        .orderBy(asc(checklistItems.position)),
      listCommentsCompat(tx, boardId),
      tx
        .select()
        .from(attachments)
        .where(eq(attachments.boardId, boardId))
        .orderBy(asc(attachments.createdAt)),
      tx.select().from(cardLinks).where(eq(cardLinks.boardId, boardId)),
      tx
        .select({ userId: boardMembers.userId, role: boardMembers.role })
        .from(boardMembers)
        .where(eq(boardMembers.boardId, boardId)),
      tx
        .select()
        .from(components)
        .where(eq(components.boardId, boardId))
        .orderBy(asc(components.name)),
      tx
        .select()
        .from(cardComponents)
        .where(eq(cardComponents.boardId, boardId)),
      tx
        .select()
        .from(cardVersions)
        .where(eq(cardVersions.workspaceId, board.workspaceId)),
      tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, board.workspaceId)),
      tx
        .select({
          subBoardId: boards.id,
          cardId: boards.parentCardId,
          title: boards.title,
        })
        .from(boards)
        .where(
          and(
            eq(boards.parentBoardId, boardId),
            isNotNull(boards.parentCardId),
            eq(boards.archived, false),
          ),
        ),
      tx
        .select({
          id: links.id,
          cardId: links.cardId,
          url: links.url,
          color: links.color,
        })
        .from(links)
        .where(
          and(eq(links.scope, "card"), eq(links.workspaceId, board.workspaceId)),
        ),
    ]);

    // Shape card-scope URL links into a card-id-keyed map. The DB color
    // column is nullable; fall back to the default diamond color so the
    // client always has a concrete value to render.
    const cardLinkByCard: Record<string, CardUrlLink> = Object.fromEntries(
      linkRows
        .filter((r) => r.cardId)
        .map((r) => [
          r.cardId as string,
          {
            id: r.id,
            cardId: r.cardId as string,
            url: r.url,
            color: r.color ?? "#facc15",
          },
        ]),
    );

    const allMemberIds = Array.from(
      new Set<string>([
        ...memberRows.map((m) => m.userId),
        ...workspaceMemberRows.map((m) => m.userId),
      ]),
    );
    const allProfileRows =
      allMemberIds.length === 0
        ? []
        : await tx
            .select({
              id: profiles.id,
              displayName: profiles.displayName,
              handle: profiles.handle,
              avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, allMemberIds));

    const boardMemberIdSet = new Set(memberRows.map((m) => m.userId));
    const profileRows = allProfileRows.filter((p) => boardMemberIdSet.has(p.id));
    const workspaceProfileRows = allProfileRows;

    return {
      board,
      lists: listRows,
      cards: cardRows,
      labels: labelRows,
      cardLabels: cardLabelRows,
      cardMembers: cardMemberRows,
      checklists: checklistRows,
      checklistItems: checklistItemRows,
      comments: commentRows,
      attachments: attachmentRows,
      cardLinks: cardLinkRows,
      components: componentRows,
      cardComponents: cardComponentRows,
      cardVersions: cardVersionRows,
      boardProfiles: profileRows,
      boardMembers: memberRows,
      workspaceProfiles: workspaceProfileRows,
      cardSubboards: subBoardRows
        .filter((r): r is { subBoardId: string; cardId: string; title: string } =>
          r.cardId !== null,
        )
        .map((r) => ({
          cardId: r.cardId,
          subBoardId: r.subBoardId,
          title: r.title,
        })),
      cardLinkByCard,
    };
  });
});
