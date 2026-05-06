-- Two more notification surfaces that were silent until now:
--
-- 1. card.linked — when card A is linked to card B (blocks /
--    is_blocked_by / relates_to / etc.), notify the watchers of B.  B
--    is the target the change affects, so its watchers care.  A's
--    watchers may already know — they were probably the ones doing
--    the linking.
--
-- 2. card.sprint_changed — when a card is added to or moved between
--    sprints, watchers want to know (planning meeting just changed
--    their day).

create or replace function public.handle_card_link_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  w record;
  src_title text;
begin
  select title into src_title from public.cards where id = new.from_card_id;
  for w in
    select cw.user_id from public.card_watchers cw where cw.card_id = new.to_card_id
  loop
    perform public.emit_notification(
      w.user_id, 'card.linked', new.to_card_id, new.board_id, new.created_by,
      jsonb_build_object(
        'from_card_id', new.from_card_id,
        'kind', new.kind::text,
        'preview', src_title
      )
    );
  end loop;
  return new;
end$$;

drop trigger if exists notif_card_links_aiu on public.card_links;
create trigger notif_card_links_aiu
  after insert on public.card_links
  for each row execute function public.handle_card_link_insert();


create or replace function public.handle_card_sprint_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  w record;
begin
  if old.sprint_id is not distinct from new.sprint_id then
    return new;
  end if;
  for w in
    select cw.user_id from public.card_watchers cw where cw.card_id = new.id
  loop
    perform public.emit_notification(
      w.user_id, 'card.sprint_changed', new.id, new.board_id, auth.uid(),
      jsonb_build_object(
        'from_sprint_id', old.sprint_id,
        'to_sprint_id', new.sprint_id
      )
    );
  end loop;
  return new;
end$$;

drop trigger if exists notif_card_sprint_change_au on public.cards;
create trigger notif_card_sprint_change_au
  after update of sprint_id on public.cards
  for each row execute function public.handle_card_sprint_change();
