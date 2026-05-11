-- Notify the people who care when a card is marked complete. The
-- activity feed already records completion (0086) but stops short of
-- pushing a row to anyone's inbox. Owners + assignees + watchers get
-- notified the same way `card.archived` already does — high-signal
-- transition, low cardinality, no bundling needed.
--
-- Trigger fires only on the NULL → not-NULL transition. Un-completing
-- (not-NULL → NULL) is silent on purpose; if a teammate undoes their
-- own click, no one needs an inbox row about it.
--
-- The kind enum (0080) didn't include `card.completed`, so extend it
-- here. Mirrors the additive style of 0080 (drop + recreate the
-- check).

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'comment.mention',
    'comment.create',
    'card.assigned',
    'card.unassigned',
    'card.owner_assigned',
    'card.owner_unassigned',
    'card.archived',
    'card.unarchived',
    'card.moved',
    'card.due',
    'card.dates',
    'card.label.added',
    'card.linked',
    'card.sprint_changed',
    'card.completed',
    'board.member.added'
  ));


create or replace function public.notify_card_completed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  recipients uuid[];
  r uuid;
begin
  -- Only fire on transitions, and only on NULL → not-NULL. We let the
  -- "uncomplete" path stay silent — see 0086 for the matching activity
  -- emitter that does record both directions on the feed.
  if old.completed_at is not distinct from new.completed_at then
    return null;
  end if;
  if not (old.completed_at is null and new.completed_at is not null) then
    return null;
  end if;

  -- Build the recipient set: owner + every card_member + every watcher.
  -- emit_notification dedupes self-notify (actor == recipient) and
  -- honors the per-user opt-out, but we still dedupe here so a user
  -- who is owner + assignee + watcher only gets one row.
  recipients := array(
    select distinct user_id from (
      select new.owner_id as user_id where new.owner_id is not null
      union
      select cm.user_id from public.card_members cm where cm.card_id = new.id
      union
      select cw.user_id from public.card_watchers cw where cw.card_id = new.id
    ) s
    where user_id is not null
  );

  foreach r in array recipients loop
    perform public.emit_notification(
      r, 'card.completed', new.id, new.board_id, actor,
      jsonb_build_object('title', new.title)
    );
  end loop;

  return null;
end$$;

drop trigger if exists notif_card_completed_aud on public.cards;
create trigger notif_card_completed_aud
  after update of completed_at on public.cards
  for each row execute function public.notify_card_completed();
