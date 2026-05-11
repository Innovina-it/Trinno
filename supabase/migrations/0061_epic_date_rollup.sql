-- Epic-as-container date rollup. When a child card's start_date /
-- target_date / parent_card_id / archived changes (or row is inserted /
-- deleted), the parent epic's span is *extended* to encompass all live
-- children. Manual epic dates win on shrink — only expansion is
-- automatic. Rationale: PMs set epic span as a target; children should
-- never silently shorten it, but pushing a child past the end should
-- visibly stretch the epic.
--
-- Depth: epic constraints (#0051) limit hierarchy to single-level epics,
-- so the recursive trigger fires at most twice (child → parent → null).
--
-- security definer: rollup updates parent rows that the calling user may
-- not own; RLS would reject. The trigger runs as definer to bypass that
-- safely — read of children is implicit via the trigger's local query.

create or replace function public.cards_rollup_epic_dates()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  pid uuid;
  prev_pid uuid;
  min_start timestamptz;
  max_target timestamptz;
begin
  if tg_op = 'DELETE' then
    pid := old.parent_card_id;
    prev_pid := null;
  elsif tg_op = 'INSERT' then
    pid := new.parent_card_id;
    prev_pid := null;
  else
    pid := new.parent_card_id;
    if old.parent_card_id is distinct from new.parent_card_id then
      prev_pid := old.parent_card_id;
    else
      prev_pid := null;
    end if;
  end if;

  if pid is not null then
    select min(start_date), max(target_date) into min_start, max_target
      from public.cards
      where parent_card_id = pid and archived = false;
    update public.cards p set
      start_date = case
        when min_start is null then p.start_date
        when p.start_date is null or min_start < p.start_date then min_start
        else p.start_date
      end,
      target_date = case
        when max_target is null then p.target_date
        when p.target_date is null or max_target > p.target_date then max_target
        else p.target_date
      end
    where p.id = pid;
  end if;

  if prev_pid is not null then
    select min(start_date), max(target_date) into min_start, max_target
      from public.cards
      where parent_card_id = prev_pid and archived = false;
    update public.cards p set
      start_date = case
        when min_start is null then p.start_date
        when p.start_date is null or min_start < p.start_date then min_start
        else p.start_date
      end,
      target_date = case
        when max_target is null then p.target_date
        when p.target_date is null or max_target > p.target_date then max_target
        else p.target_date
      end
    where p.id = prev_pid;
  end if;

  return coalesce(new, old);
end$$;

drop trigger if exists cards_rollup_epic_dates_aiu on public.cards;
create trigger cards_rollup_epic_dates_aiu
  after insert or update of start_date, target_date, parent_card_id, archived on public.cards
  for each row execute function public.cards_rollup_epic_dates();

drop trigger if exists cards_rollup_epic_dates_ad on public.cards;
create trigger cards_rollup_epic_dates_ad
  after delete on public.cards
  for each row execute function public.cards_rollup_epic_dates();
