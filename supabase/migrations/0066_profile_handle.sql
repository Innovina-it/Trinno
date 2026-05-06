-- @mention resolution previously matched `lower(display_name) = handle`.
-- That broke as soon as a user updated their display name to anything
-- with a space, and any two users with overlapping lowercased names
-- both received the notification.  Add a dedicated `handle` column —
-- normalized, unique, and decoupled from display_name — and update
-- parse_mentions to match against it.

-- 1. New column on profiles.
alter table public.profiles
  add column if not exists handle text;

-- 2. Backfill from existing display_names.  We slugify by keeping
--    [a-z0-9_.-] characters and dropping the rest, then disambiguate
--    duplicates with a numeric suffix in insertion order.  Fallback to
--    the user's id-prefix if the result is empty.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in
    select id, display_name from public.profiles
    where handle is null
    order by created_at asc
  loop
    base := regexp_replace(lower(coalesce(r.display_name, '')), '[^a-z0-9_.\-]+', '', 'g');
    if base = '' then
      base := substr(replace(r.id::text, '-', ''), 1, 8);
    end if;
    candidate := base;
    n := 1;
    while exists (select 1 from public.profiles where handle = candidate) loop
      n := n + 1;
      candidate := base || n::text;
    end loop;
    update public.profiles set handle = candidate where id = r.id;
  end loop;
end$$;

-- 3. Lock it in: not null + unique + index.
alter table public.profiles
  alter column handle set not null;

create unique index if not exists profiles_handle_key
  on public.profiles (handle);

-- 4. New-user trigger derives a handle alongside display_name.  Same
--    slug rules; suffix-numbered if it collides.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_workspace_id uuid;
  local_part text := split_part(new.email, '@', 1);
  base_handle text;
  candidate text;
  n int := 1;
begin
  base_handle := regexp_replace(lower(local_part), '[^a-z0-9_.\-]+', '', 'g');
  if base_handle = '' then
    base_handle := substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := base_handle || n::text;
  end loop;

  insert into public.profiles (id, display_name, handle)
  values (new.id, local_part, candidate);

  insert into public.workspaces (name, owner_id)
  values (local_part || '''s Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

-- 5. parse_mentions now matches profiles.handle directly (and the
--    handle loop in handle_comment_insert keeps the same shape).
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

  -- mentions: resolve `@handle` against profiles.handle (case insensitive,
  -- but handles are already lowercased at write time).
  for m in select * from public.parse_mentions(new.body) loop
    select id into uid from public.profiles where handle = m.handle limit 1;
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

  -- watchers: notify, excluding anyone who already got `comment.mention`.
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
