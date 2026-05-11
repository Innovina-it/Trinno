-- Unify "card is done" semantics on a single column: `cards.completed_at`.
--
-- (Supersedes the old 0058_card_completed_at.sql.disabled template,
-- which proposed the same column with a separate `setCardCompleted`
-- action; the dual-write trigger approach below shipped instead and
-- the disabled template has been removed.)
--
-- Before this migration the codebase had three overlapping notions:
--   1. cards.due_complete (bool) — set via the "Mark complete" checkbox
--      in the card modal.
--   2. cards.archived (bool) — burndown stats inferred completion from
--      the most recent `card.archive` activity row, which is wrong (a
--      card can be archived for reasons other than completion).
--   3. lists.status_kind = 'done' — purely visual board column kind.
--
-- We now treat `completed_at` as the single source of truth. The
-- `due_complete` boolean stays for backwards-compat (existing API and
-- UI), but a sync trigger keeps both in lockstep so nothing else needs
-- to special-case the dual-write.
--
-- security definer trigger so RLS doesn't reject the auto-set when a
-- caller updates only one of the two columns.

alter table public.cards
  add column if not exists completed_at timestamptz;

create index if not exists cards_completed_at_idx
  on public.cards (completed_at) where completed_at is not null;

-- Backfill: any card that was already marked due_complete=true gets a
-- completed_at timestamp. We don't know the original completion moment
-- so use created_at as a conservative best-guess (used only by burndown
-- which clamps to sprint range anyway).
update public.cards
  set completed_at = coalesce(due_date, created_at)
  where due_complete = true and completed_at is null;

-- Bi-directional sync trigger: setting one auto-mirrors the other. Lets
-- any code path (legacy `dueComplete` setter, new `completedAt` setter,
-- or a direct SQL update) leave the row in a consistent state.
create or replace function public.cards_sync_completed()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.due_complete = true and new.completed_at is null then
      new.completed_at := now();
    elsif new.due_complete = false and new.completed_at is not null then
      new.due_complete := true;
    end if;
    return new;
  end if;

  -- UPDATE: figure out which side the caller mutated and propagate.
  if new.due_complete is distinct from old.due_complete then
    if new.due_complete = true and new.completed_at is null then
      new.completed_at := now();
    elsif new.due_complete = false then
      new.completed_at := null;
    end if;
  end if;

  if new.completed_at is distinct from old.completed_at then
    new.due_complete := new.completed_at is not null;
  end if;

  return new;
end$$;

drop trigger if exists cards_sync_completed_biu on public.cards;
create trigger cards_sync_completed_biu
  before insert or update of due_complete, completed_at on public.cards
  for each row execute function public.cards_sync_completed();
