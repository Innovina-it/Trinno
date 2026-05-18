-- 0105 - cards-as-sub-board pointer.
--
-- Each card may own at most one sub-board (boards.parent_card_id 1:1).
-- A sub-board still lives under a parent board (parent_board_id, 0099),
-- so the new column is a sibling pointer: it identifies the *anchor card*
-- on the parent board that surfaces the sub-board to users.
--
-- Deleting the anchor card sets the pointer NULL (orphans the sub-board
-- rather than cascade-deleting nested data — explicit cleanup is safer).

alter table public.boards
  add column if not exists parent_card_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'boards_parent_card_id_fkey'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_parent_card_id_fkey
      foreign key (parent_card_id)
      references public.cards(id)
      on delete set null;
  end if;
end$$;

create unique index if not exists boards_parent_card_id_uq
  on public.boards (parent_card_id)
  where parent_card_id is not null;

comment on column public.boards.parent_card_id
  is 'PARENT_CARD_ID: anchor card on parent_board_id surfacing this sub-board to users. 1:1 with cards.';
