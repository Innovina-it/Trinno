import { eq, asc, and, inArray, sql } from "drizzle-orm";
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
  profiles,
  cardLinks,
  components,
  cardComponents,
  cardVersions,
} from "@/lib/db/schema";

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

export async function getBoardSnapshot(
  token: string,
  boardId: string,
): Promise<BoardSnapshot | null> {
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
    ]);

    const memberIds = memberRows.map((m) => m.userId);
    const profileRows =
      memberIds.length === 0
        ? []
        : await tx
            .select({
              id: profiles.id,
              displayName: profiles.displayName,
              handle: profiles.handle,
              avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, memberIds));

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
    };
  });
}
