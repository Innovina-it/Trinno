import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, lists } from "@/lib/db/schema";

export type EpicCardRow = typeof cards.$inferSelect;
export type EpicListRow = typeof lists.$inferSelect;

export type EpicSnapshot = {
  epic: EpicCardRow;
  children: EpicCardRow[];
  lists: EpicListRow[];
};

/**
 * Plan #epic-as-kanban — server-side fetch for the epic-kanban page.
 * Returns the epic, its DIRECT children (parent_card_id = epicId), and
 * all lists on the epic's home board. Returns null when the id does not
 * resolve to an epic visible to the caller.
 */
export async function listEpicChildren(
  token: string,
  epicId: string,
): Promise<EpicSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const [epic] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.id, epicId), eq(cards.type, "epic")));
    if (!epic) return null;

    const children = await tx
      .select()
      .from(cards)
      .where(eq(cards.parentCardId, epicId));

    const boardLists = await tx
      .select()
      .from(lists)
      .where(eq(lists.boardId, epic.boardId));

    return { epic, children, lists: boardLists };
  });
}
