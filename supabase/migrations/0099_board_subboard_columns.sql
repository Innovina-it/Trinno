-- 0099 - board hierarchy columns for sub-boards.
--
-- Sub-boards are regular boards with a nullable parent_board_id. Deleting
-- a parent board must not cascade-delete child boards, so the FK is
-- ON DELETE SET NULL.

alter table public.boards
  add column if not exists parent_board_id uuid,
  add column if not exists _migrated_from_epic_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'boards_parent_board_id_fkey'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_parent_board_id_fkey
      foreign key (parent_board_id)
      references public.boards(id)
      on delete set null;
  end if;
end$$;

create index if not exists boards_parent_board_id_idx
  on public.boards (parent_board_id)
  where parent_board_id is not null;

create unique index if not exists boards_migrated_from_epic_id_uq
  on public.boards (_migrated_from_epic_id)
  where _migrated_from_epic_id is not null;

comment on column public.boards._migrated_from_epic_id
  is 'MIGRATED_FROM_EPIC_ID: source cards.id for Epic-to-sub-board migration traceability.';
