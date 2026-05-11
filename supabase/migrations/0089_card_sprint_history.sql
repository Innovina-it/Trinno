-- Card → sprint assignment history. Velocity attribution previously
-- read `cards.sprint_id` directly: a card moved from S1 → S2 after it
-- was already completed under S1 would be (incorrectly) credited to
-- S2. We now record every sprint assignment with an open/close window
-- and attribute completion to whichever sprint the card was IN when
-- `completed_at` was set.
--
-- The trigger in 0082/0083 still gates WHO can change `sprint_id`;
-- this trigger is independent and only records the change. Both run
-- on the same UPDATE OF sprint_id event — order is undefined but they
-- don't share state.

create table if not exists public.card_sprint_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  sprint_id uuid references public.sprints(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz
);

create index if not exists card_sprint_history_card_assigned_idx
  on public.card_sprint_history (card_id, assigned_at desc);

create index if not exists card_sprint_history_open_sprint_idx
  on public.card_sprint_history (sprint_id)
  where removed_at is null;


-- Trigger fn: record every sprint assignment as an open history row
-- and close the prior open row when the card moves. Two firing paths:
--   - AFTER INSERT: a new card may already carry a sprint_id (rare;
--     bulk import / "duplicate from card"). Open a row immediately.
--   - BEFORE UPDATE OF sprint_id: a reassignment closes the old row
--     and (when not moving to backlog) opens a new one.
-- security definer because RLS would otherwise reject inserts the
-- table issues on behalf of users who are not the row owner.
--
-- Note: locals are prefixed with `_` per 0083 — bare names like
-- `card_id` collide with the column reference inside embedded
-- statements and raise "ambiguous column" at trigger fire time.
create or replace function public.track_card_sprint_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.sprint_id is not null then
      insert into public.card_sprint_history (card_id, sprint_id, assigned_at)
        values (new.id, new.sprint_id, coalesce(new.created_at, now()));
    end if;
    return new;
  end if;

  -- UPDATE path. The 0082/0083 policy trigger already vetted this
  -- change; we just record it. `is not distinct from` handles the
  -- null-vs-null case where neither side changed.
  if old.sprint_id is not distinct from new.sprint_id then
    return new;
  end if;

  update public.card_sprint_history
     set removed_at = now()
   where card_id = old.id
     and removed_at is null;

  if new.sprint_id is not null then
    insert into public.card_sprint_history (card_id, sprint_id)
      values (new.id, new.sprint_id);
  end if;

  return new;
end$$;

drop trigger if exists track_card_sprint_change_bu on public.cards;
create trigger track_card_sprint_change_bu
  before update of sprint_id on public.cards
  for each row execute function public.track_card_sprint_change();

drop trigger if exists track_card_sprint_change_ai on public.cards;
create trigger track_card_sprint_change_ai
  after insert on public.cards
  for each row execute function public.track_card_sprint_change();


-- Backfill: every currently-assigned card gets one open history row.
-- Idempotent: a re-run only inserts for cards that don't already have
-- a row (any row, open or closed). For initial backfill we use
-- `created_at` as the assignment timestamp — we don't know the actual
-- assignment time, but it's a safe lower bound that still includes
-- any completion in [created_at, now()].
insert into public.card_sprint_history (card_id, sprint_id, assigned_at)
select c.id, c.sprint_id, c.created_at
from public.cards c
where c.sprint_id is not null
  and not exists (
    select 1 from public.card_sprint_history h
     where h.card_id = c.id
  );


-- RLS mirrors `cards_select` from 0006: a user can read history for a
-- card iff they can read the card itself (board member, or
-- workspace-visible board with a workspace membership). No INSERT /
-- UPDATE / DELETE policies — the trigger writes via security definer
-- and nothing else should mutate this table.
alter table public.card_sprint_history enable row level security;

drop policy if exists card_sprint_history_select on public.card_sprint_history;
create policy card_sprint_history_select on public.card_sprint_history for select
  using (
    exists (
      select 1
        from public.cards c
        where c.id = card_sprint_history.card_id
          and (
            exists (
              select 1 from public.board_members bm
                where bm.board_id = c.board_id and bm.user_id = auth.uid()
            )
            or exists (
              select 1 from public.boards b
                where b.id = c.board_id
                  and b.visibility = 'workspace'
                  and exists (
                    select 1 from public.workspace_members wm
                      where wm.workspace_id = b.workspace_id
                        and wm.user_id = auth.uid()
                  )
            )
          )
    )
  );
