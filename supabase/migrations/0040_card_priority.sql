-- Plan #16b-γ-C (#1) — card priority enum.
--
-- Captures the urgency / impact dimension that's orthogonal to status
-- and type. Five levels (P0 critical → P4 trivial) is the most common
-- bug-tracker scheme and gives a `null` "unset" for cards where
-- priority hasn't been triaged yet.
--
-- Indexed by (board_id, priority) so the backlog and dashboards can
-- group / sort cheaply without scanning every card on the board.

create type public.card_priority as enum ('p0','p1','p2','p3','p4');

alter table public.cards
  add column priority public.card_priority;

create index cards_board_id_priority_idx
  on public.cards (board_id, priority);
