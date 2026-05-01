-- Plan #16b-γ-D (#37) — when a card moves to another board, the
-- existing per-table `set_*_board_id` triggers don't re-fire because
-- they listen on `card_id` changes, not on the card's `board_id`. Add
-- a single trigger on `cards` that ripples a board_id change through
-- every dependent table (comments, checklists, checklist_items,
-- attachments, card_labels, card_members, card_components, card_links,
-- card_watchers, card_sla, worklogs).
--
-- Done in one statement-level trigger to keep the round-trip count
-- bounded; SECURITY DEFINER so the cascade runs with elevated rights
-- (the user's RLS already authorized the parent UPDATE on cards via
-- WITH CHECK against the new board_id, so the cascade is safe — the
-- caller couldn't have reached this point without permission to write
-- the destination board).

create or replace function public.cards_propagate_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.board_id is distinct from old.board_id then
    update public.comments        set board_id = new.board_id where card_id = new.id;
    update public.checklists      set board_id = new.board_id where card_id = new.id;
    update public.checklist_items
      set board_id = new.board_id
      where checklist_id in (select id from public.checklists where card_id = new.id);
    update public.attachments     set board_id = new.board_id where card_id = new.id;
    update public.card_labels     set board_id = new.board_id where card_id = new.id;
    update public.card_members    set board_id = new.board_id where card_id = new.id;
    update public.card_components set board_id = new.board_id where card_id = new.id;
    update public.card_watchers   set board_id = new.board_id where card_id = new.id;
    update public.worklogs        set board_id = new.board_id where card_id = new.id;
    update public.card_sla        set board_id = new.board_id where card_id = new.id;
    -- card_links: links live on the from-card's board. When either end
    -- moves, the link's board_id should follow the from-card.
    update public.card_links
      set board_id = new.board_id
      where from_card_id = new.id;
  end if;
  return new;
end;
$$;

create trigger cards_cascade_board_id
  after update of board_id on public.cards
  for each row execute function public.cards_propagate_board_id();
