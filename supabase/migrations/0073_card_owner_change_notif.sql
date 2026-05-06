-- Owner reassignment is a high-signal change (someone is now
-- accountable for this card) but was silent until now.  Mirror the
-- existing card.assigned / card.unassigned trigger so the card
-- modal owner picker drives an inbox row + auto-watch on the new
-- owner, and a "you were taken off" row on the previous owner.

create or replace function public.handle_card_owner_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.owner_id is not distinct from new.owner_id then
    return new;
  end if;

  -- Old owner: notification only (no auto-unwatch — they may still
  -- want to follow the card as a watcher).
  if old.owner_id is not null then
    perform public.emit_notification(
      old.owner_id, 'card.owner_unassigned', new.id, new.board_id, auth.uid(),
      jsonb_build_object('title', new.title)
    );
  end if;

  -- New owner: notification + auto-watch.
  if new.owner_id is not null then
    perform public.emit_notification(
      new.owner_id, 'card.owner_assigned', new.id, new.board_id, auth.uid(),
      jsonb_build_object('title', new.title)
    );
    insert into public.card_watchers (card_id, user_id, board_id, auto)
      values (new.id, new.owner_id, new.board_id, true)
      on conflict do nothing;
  end if;

  return new;
end$$;

drop trigger if exists notif_card_owner_change_au on public.cards;
create trigger notif_card_owner_change_au
  after update of owner_id on public.cards
  for each row execute function public.handle_card_owner_change();
