-- Plan #epic-as-kanban — close the race window in ensureStatusListImpl
-- by enforcing at most one list per (board_id, status_kind) at the DB
-- level. The action's SELECT-then-INSERT pattern was vulnerable to two
-- concurrent calls both missing the existence check.
--
-- Pre-step: any existing duplicates (user manually mapped two lists to
-- the same status_kind) get resolved by keeping the oldest list and
-- nulling status_kind on the rest. NOTICE per affected board for the
-- deploy log.

do $$
declare
  affected int;
begin
  with ranked as (
    select id,
           board_id,
           status_kind,
           row_number() over (
             partition by board_id, status_kind
             order by created_at, id
           ) as rn
    from public.lists
    where status_kind is not null
  ),
  cleared as (
    update public.lists l
    set status_kind = null
    from ranked r
    where l.id = r.id and r.rn > 1
    returning l.id
  )
  select count(*) into affected from cleared;
  if affected > 0 then
    raise notice 'epic-as-kanban: cleared status_kind on % duplicate lists (kept oldest per board+status)', affected;
  end if;
end$$;

-- Partial unique index: at most one mapped list per (board, status).
-- NULL status_kind values are exempt (multiple unmapped lists per
-- board are still allowed).
create unique index if not exists lists_board_id_status_kind_uq
  on public.lists (board_id, status_kind)
  where status_kind is not null;
