-- Emit activity rows when a card is marked complete / uncompleted, so
-- the activity feed records completion the same way it records
-- archive/unarchive. The feed already maps `card.archive` and
-- `card.unarchive`; `card.complete` / `card.uncomplete` join that set.
--
-- Completion is gated on `cards.completed_at` (single source of truth
-- since 0062 — `due_complete` is mirrored bi-directionally by the
-- `cards_sync_completed` trigger). We watch transitions on
-- `completed_at` so a single emit fires regardless of whether the
-- caller toggled `due_complete` or `completed_at` directly.
--
-- security definer so RLS doesn't reject the activity insert when
-- non-owner board members complete a card.

create or replace function public.activity_cards_completed_aud()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.completed_at is not distinct from new.completed_at then
    return null;
  end if;

  if old.completed_at is null and new.completed_at is not null then
    perform public.log_activity(new.board_id, new.id, 'card.complete',
      jsonb_build_object('title', new.title));
  elsif old.completed_at is not null and new.completed_at is null then
    perform public.log_activity(new.board_id, new.id, 'card.uncomplete',
      jsonb_build_object('title', new.title));
  end if;

  return null;
end$$;

drop trigger if exists activity_cards_completed_aud on public.cards;
create trigger activity_cards_completed_aud
  after update of completed_at on public.cards
  for each row execute function public.activity_cards_completed_aud();
