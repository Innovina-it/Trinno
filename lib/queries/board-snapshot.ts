import { eq, asc, and, inArray } from "drizzle-orm";
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
export type BoardProfile = { id: string; displayName: string };

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
  boardProfiles: BoardProfile[];
};

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
      tx
        .select()
        .from(comments)
        .where(eq(comments.boardId, boardId))
        .orderBy(asc(comments.createdAt)),
      tx
        .select()
        .from(attachments)
        .where(eq(attachments.boardId, boardId))
        .orderBy(asc(attachments.createdAt)),
      tx.select().from(cardLinks).where(eq(cardLinks.boardId, boardId)),
      tx
        .select({ userId: boardMembers.userId })
        .from(boardMembers)
        .where(eq(boardMembers.boardId, boardId)),
    ]);

    const memberIds = memberRows.map((m) => m.userId);
    const profileRows =
      memberIds.length === 0
        ? []
        : await tx
            .select({ id: profiles.id, displayName: profiles.displayName })
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
      boardProfiles: profileRows,
    };
  });
}
