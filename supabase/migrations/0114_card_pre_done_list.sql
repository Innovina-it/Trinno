-- Roadmap completion <-> board "done" sync.
-- Remembers the list a card sat in immediately before the roadmap
-- auto-moved it to a 'done' list, so un-completing can send it back.
-- ON DELETE SET NULL: if that list is deleted while the card is
-- completed, the revert target safely vanishes (card stays in done).
alter table public.cards
  add column pre_done_list_id uuid
  references public.lists(id) on delete set null;
