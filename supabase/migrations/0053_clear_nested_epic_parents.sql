-- Plan #epic-as-kanban — pre-deploy cleanup. Any pre-existing epic
-- card whose parent_card_id points at another epic violates the
-- single-level-epic rule enforced by the 0051 trigger. Clear those
-- parents (set NULL); emit a NOTICE with the affected count for
-- deploy log preservation.

do $$
declare
  affected int;
begin
  with cleared as (
    update public.cards c
    set parent_card_id = null
    from public.cards p
    where c.parent_card_id = p.id
      and c.type = 'epic'
      and p.type = 'epic'
    returning c.id
  )
  select count(*) into affected from cleared;
  if affected > 0 then
    raise notice 'epic-as-kanban: cleared parent_card_id on % epic cards (single-level enforced)', affected;
  end if;
end$$;

-- Diagnostic helper: count of rows that violate the single-level rule.
-- Should always return 0 on a healthy database. Matches the convention
-- from 0052's count_cross_board_epic_children.
create or replace function public.count_nested_epic_parents()
returns bigint language sql stable parallel safe security definer set search_path = public
as $$
  select count(*)::bigint
  from public.cards c
  join public.cards p on p.id = c.parent_card_id
  where c.type = 'epic' and p.type = 'epic';
$$;

revoke all on function public.count_nested_epic_parents() from public;
grant execute on function public.count_nested_epic_parents() to authenticated, service_role;
