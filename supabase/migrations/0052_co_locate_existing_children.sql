-- Plan #epic-as-kanban — one-shot backfill. Migrate any existing
-- cross-board children of epics onto the epic's home board. Idempotent:
-- re-running selects zero rows once the BEFORE trigger from 0051 keeps
-- the invariant going forward.

update public.cards c
set board_id = p.board_id
from public.cards p
where c.parent_card_id = p.id
  and p.type = 'epic'
  and c.board_id <> p.board_id;

-- Convenience helper for tests + diagnostics: count of rows that violate
-- the invariant. Should always return 0 on a healthy database.
create or replace function public.count_cross_board_epic_children()
returns bigint language sql stable parallel safe security definer set search_path = public
as $$
  select count(*)::bigint
  from public.cards c
  join public.cards p on p.id = c.parent_card_id
  where p.type = 'epic' and c.board_id <> p.board_id;
$$;

revoke all on function public.count_cross_board_epic_children() from public;
grant execute on function public.count_cross_board_epic_children() to authenticated, service_role;
