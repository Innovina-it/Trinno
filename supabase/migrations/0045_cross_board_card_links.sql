-- Plan #16b-γ-D (#38) — cross-board card linking.
--
-- Existing setup (migration 0019) constrains both ends of a link to
-- live on the same board: the trigger `set_card_link_board_id` raises
-- when from-card.board_id <> to-card.board_id. This blocks legitimate
-- cross-board "blocks/related-to" relationships that are common in
-- larger teams (e.g. a frontend bug blocked by a backend story on a
-- different board).
--
-- Changes:
--   1. The trigger now stamps `board_id` from the FROM card only —
--      the link "belongs to" its from-card's board. Mirror inserts
--      flip from/to so the inverse row's board_id naturally lands on
--      the other board.
--   2. The SELECT policy widens to "member of EITHER endpoint's board"
--      so a card view on board B can list links pointing to it from
--      board A.
--   3. The INSERT/UPDATE/DELETE policy still requires write access to
--      the from-card's board. Mirror trigger is SECURITY DEFINER so it
--      cross-boards safely.
--
-- Compatibility: existing same-board links keep working — the trigger
-- continues to set board_id from the from-card. The constraint we
-- removed was a strict equality between from/to; nothing in the schema
-- assumed cross-board links were impossible (board_id was always a
-- denorm of the from-card via the same trigger path).

create or replace function public.set_card_link_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  bid_from uuid;
begin
  select board_id into bid_from from public.cards where id = new.from_card_id;
  if bid_from is null then
    raise exception 'card_links: missing from_card';
  end if;
  -- The to-card's existence is enforced by the FK; we no longer require
  -- it to share a board with the from-card.
  new.board_id := bid_from;
  return new;
end$$;

-- Widen SELECT: readable if the user can see EITHER endpoint's board.
drop policy if exists card_links_select on public.card_links;
create policy card_links_select on public.card_links for select
  using (
    -- Member of from-card's board (the canonical link.board_id)
    exists (
      select 1 from public.board_members bm
      where bm.board_id = card_links.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where b.id = card_links.board_id and b.visibility = 'workspace'
        and wm.user_id = auth.uid()
    )
    -- Member of to-card's board
    or exists (
      select 1
      from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = card_links.to_card_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.cards c
      join public.boards b on b.id = c.board_id
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where c.id = card_links.to_card_id and b.visibility = 'workspace'
        and wm.user_id = auth.uid()
    )
  );

-- The mirror trigger inserts the inverse row. The original migration
-- already created it with SECURITY DEFINER, which is what lets a user
-- with write on board A create a link to a card on board B without
-- needing write on board B. Re-state the function so the source of
-- truth lives alongside the policy widening above.
create or replace function public.mirror_card_link()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inverse public.link_kind;
  bid_to uuid;
begin
  inverse := case new.kind
    when 'blocks'             then 'is_blocked_by'::public.link_kind
    when 'is_blocked_by'      then 'blocks'::public.link_kind
    when 'duplicates'         then 'is_duplicated_by'::public.link_kind
    when 'is_duplicated_by'   then 'duplicates'::public.link_kind
    when 'relates_to'         then 'relates_to'::public.link_kind
  end;
  if inverse is null then return new; end if;
  -- The mirror's from is the original to; its board_id is the to-card's
  -- board. Resolve directly so the mirror's BEFORE trigger picks the
  -- correct value.
  select board_id into bid_to from public.cards where id = new.to_card_id;
  if bid_to is null then return new; end if;
  insert into public.card_links (from_card_id, to_card_id, kind, board_id, created_by)
  values (new.to_card_id, new.from_card_id, inverse, bid_to, new.created_by)
  on conflict (from_card_id, to_card_id, kind) do nothing;
  return new;
end$$;
