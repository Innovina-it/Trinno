-- Plan #13 — Roadmap / Timeline / Gantt
-- Adds nullable start_date + target_date to cards. due_date stays as a hard deadline;
-- target_date is the planned end of work for roadmap purposes.

alter table public.cards
  add column start_date timestamptz,
  add column target_date timestamptz;

create index cards_board_start_date_idx
  on public.cards (board_id, start_date)
  where start_date is not null;
