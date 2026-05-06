-- handle_comment_insert previously sent two notifications to anyone
-- both watching a card AND @mentioned in the comment: a
-- `comment.mention` from the mention loop and a `comment.create` from
-- the watcher loop.  The watcher loop ran second and didn't know which
-- users had already received `comment.mention`, so the inbox got
-- duplicate entries.
--
-- Track mentioned uids in a temp array and skip them during the
-- watcher loop.  Mention-only is the higher-signal notification, so we
-- prefer it over comment.create.

create or replace function public.handle_comment_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  w record;
  m record;
  uid uuid;
  mentioned uuid[] := array[]::uuid[];
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
      mentioned := mentioned || uid;
    end if;
  end loop;

  -- watchers → notification, EXCLUDING anyone who just got `comment.mention`
  for w in
    select cw.user_id
    from public.card_watchers cw
    where cw.card_id = new.card_id
      and cw.user_id <> all(mentioned)
  loop
    perform public.emit_notification(
      w.user_id, 'comment.create', new.card_id, new.board_id, new.author_id,
      jsonb_build_object('comment_id', new.id, 'preview', left(new.body, 200))
    );
  end loop;

  return new;
end$$;
