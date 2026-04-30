-- Helper to insert a notification (SECURITY DEFINER bypasses the no-INSERT
-- policy on notifications).
create or replace function public.emit_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if; -- skip self-notify
  insert into public.notifications (
    recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload
  ) values (p_recipient, p_kind, p_card, p_board, p_actor, coalesce(p_payload, '{}'::jsonb));
end$$;

-- 1) Comments: notify all watchers + auto-watch the author + parse @mentions
create or replace function public.parse_mentions(p_body text)
returns table(handle text) language sql immutable
as $$
  select distinct lower(m[1])
  from regexp_matches(coalesce(p_body, ''), '(?<!\w)@([A-Za-z0-9_.\-]{2,40})', 'g') as t(m);
$$;

create or replace function public.handle_comment_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  w record;
  m record;
  uid uuid;
begin
  -- auto-watch the author
  insert into public.card_watchers (card_id, user_id, board_id, auto)
  values (new.card_id, new.author_id, new.board_id, true)
  on conflict do nothing;

  -- mentions → resolve handle (display_name lower) → notification + auto-watch
  for m in select * from public.parse_mentions(new.body) loop
    select id into uid from public.profiles where lower(display_name) = m.handle limit 1;
    if uid is not null then
      perform public.emit_notification(
        uid, 'comment.mention', new.card_id, new.board_id, new.author_id,
        jsonb_build_object('comment_id', new.id, 'preview', left(new.body, 200))
      );
      insert into public.card_watchers (card_id, user_id, board_id, auto)
      values (new.card_id, uid, new.board_id, true)
      on conflict do nothing;
    end if;
  end loop;

  -- watchers → notification (excluding mentioned users + author covered by emit_notification)
  for w in
    select cw.user_id from public.card_watchers cw where cw.card_id = new.card_id
  loop
    perform public.emit_notification(
      w.user_id, 'comment.create', new.card_id, new.board_id, new.author_id,
      jsonb_build_object('comment_id', new.id, 'preview', left(new.body, 200))
    );
  end loop;

  return new;
end$$;

create trigger notif_comments_aiu after insert on public.comments
  for each row execute function public.handle_comment_insert();

-- 2) card_members: assignee gets notified + auto-watch
create or replace function public.handle_card_member_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    new.user_id, 'card.assigned', new.card_id, new.board_id, auth.uid(),
    jsonb_build_object('card_id', new.card_id)
  );
  insert into public.card_watchers (card_id, user_id, board_id, auto)
  values (new.card_id, new.user_id, new.board_id, true)
  on conflict do nothing;
  return new;
end$$;

create trigger notif_card_members_aiu after insert on public.card_members
  for each row execute function public.handle_card_member_insert();

create or replace function public.handle_card_member_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    old.user_id, 'card.unassigned', old.card_id, old.board_id, auth.uid(),
    jsonb_build_object()
  );
  return old;
end$$;

create trigger notif_card_members_ad after delete on public.card_members
  for each row execute function public.handle_card_member_delete();

-- 3) cards: archive/unarchive/move/due → notify watchers
create or replace function public.handle_card_update_for_watchers()
returns trigger language plpgsql security definer set search_path = public
as $$
declare w record;
begin
  if old.archived is distinct from new.archived then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id,
        case when new.archived then 'card.archived' else 'card.unarchived' end,
        new.id, new.board_id, auth.uid(),
        jsonb_build_object('title', new.title)
      );
    end loop;
  end if;
  if (old.list_id is distinct from new.list_id) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.moved', new.id, new.board_id, auth.uid(),
        jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id)
      );
    end loop;
  end if;
  if (old.due_date is distinct from new.due_date) or (old.due_complete is distinct from new.due_complete) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.due', new.id, new.board_id, auth.uid(),
        jsonb_build_object('due_date', new.due_date, 'due_complete', new.due_complete)
      );
    end loop;
  end if;
  return new;
end$$;

create trigger notif_cards_aud after update on public.cards
  for each row execute function public.handle_card_update_for_watchers();

-- 4) board_members: new member gets a welcome notification
create or replace function public.handle_board_member_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    new.user_id, 'board.member.added', null, new.board_id, auth.uid(),
    jsonb_build_object('role', new.role)
  );
  return new;
end$$;

create trigger notif_board_members_aiu after insert on public.board_members
  for each row execute function public.handle_board_member_insert();
