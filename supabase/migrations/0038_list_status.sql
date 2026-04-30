-- Plan #16b-γ-A (#1) — map a Kanban list to a roadmap status kind so the
-- timeline bar fill can reflect "in_progress / review / done / blocked"
-- without each card carrying its own state column. The column is nullable
-- (unmapped) and read by client-side helpers; nothing on the server side
-- enforces transitions yet.

create type public.list_status_kind as enum (
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked'
);

alter table public.lists
  add column status_kind public.list_status_kind;

create index lists_board_id_status_kind_idx
  on public.lists (board_id, status_kind);
