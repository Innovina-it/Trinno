import { sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";

export async function searchCards(token: string, query: string, limit = 20) {
  if (!query.trim()) return [];
  return dbAsUser(token, async (tx) => {
    const rows = await tx.execute(sql`
      select c.id, c.title, c.description, c.list_id, c.board_id,
             b.title as board_title
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.archived = false
        and c.tsv @@ websearch_to_tsquery('simple', ${query})
      order by ts_rank(c.tsv, websearch_to_tsquery('simple', ${query})) desc
      limit ${limit}
    `);
    return (rows as unknown as Array<{
      id: string; title: string; description: string | null;
      list_id: string; board_id: string; board_title: string;
    }>).map(r => ({
      id: r.id, title: r.title, description: r.description,
      listId: r.list_id, boardId: r.board_id, boardTitle: r.board_title,
    }));
  });
}

/**
 * Plan #16b-γ-D (#38) — cross-board search for the link picker.
 *
 * Same shape as `searchCards` but also includes cards with empty/short
 * queries (returns recent cards instead) so the picker can show
 * something on first open. RLS still scopes results to readable boards.
 */
export async function searchCardsForLink(
  token: string,
  query: string,
  limit = 30,
) {
  return dbAsUser(token, async (tx) => {
    if (!query.trim()) {
      const rows = await tx.execute(sql`
        select c.id, c.title, c.list_id, c.board_id,
               b.title as board_title, c.type
        from public.cards c
        join public.boards b on b.id = c.board_id
        where c.archived = false
        order by c.created_at desc
        limit ${limit}
      `);
      return (rows as unknown as Array<{
        id: string; title: string; list_id: string;
        board_id: string; board_title: string; type: string;
      }>).map(r => ({
        id: r.id, title: r.title, listId: r.list_id,
        boardId: r.board_id, boardTitle: r.board_title, type: r.type,
      }));
    }
    const rows = await tx.execute(sql`
      select c.id, c.title, c.list_id, c.board_id,
             b.title as board_title, c.type
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.archived = false
        and (
          c.tsv @@ websearch_to_tsquery('simple', ${query})
          or lower(c.title) like ${"%" + query.toLowerCase() + "%"}
        )
      order by ts_rank(c.tsv, websearch_to_tsquery('simple', ${query})) desc nulls last,
               c.created_at desc
      limit ${limit}
    `);
    return (rows as unknown as Array<{
      id: string; title: string; list_id: string;
      board_id: string; board_title: string; type: string;
    }>).map(r => ({
      id: r.id, title: r.title, listId: r.list_id,
      boardId: r.board_id, boardTitle: r.board_title, type: r.type,
    }));
  });
}
