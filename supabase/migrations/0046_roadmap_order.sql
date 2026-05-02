-- Plan #16b-γ-G G1 — manual order axis for roadmap rows.
-- NULL = unranked (sort by start_date ASC, created_at ASC).
-- When set, use sparse-int ranks (Linear/Jira pattern) so reorders only
-- write the moved card and rare full-board renumberings.

alter table public.cards add column roadmap_order int;

create index cards_board_roadmap_order_idx
  on public.cards (board_id, roadmap_order)
  where roadmap_order is not null;
