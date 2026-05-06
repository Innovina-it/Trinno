-- Bulk-action notification dedup.  When a user archives 12 cards in
-- one shift+select, every watcher previously received 12 separate
-- inbox rows.  This collapses them into one row whose payload counts
-- the bundle.
--
-- Approach: optional `bundle_key` column on notifications + a sibling
-- helper `emit_bundled_notification` that the bulk-prone triggers use.
-- emit_notification keeps its existing single-row semantics.
--
-- Bundle key = recipient + kind + board + minute-bucket of created_at.
-- 60s window means: a sustained drag across multiple lists fires
-- multiple bundles, but a quick shift-select archive collapses to one.

alter table public.notifications
  add column if not exists bundle_key text;

create unique index if not exists notifications_bundle_key_unq
  on public.notifications (bundle_key)
  where bundle_key is not null;

create or replace function public.emit_bundled_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
declare
  bucket bigint;
  bkey text;
  existing_id uuid;
  existing_payload jsonb;
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if;

  -- Per-user opt-out (mirror emit_notification).
  if exists (
    select 1 from public.user_notification_prefs unp
    where unp.user_id = p_recipient
      and unp.kind = p_kind
      and unp.channel = 'in_app'
      and unp.enabled = false
  ) then
    return;
  end if;

  -- 60s buckets: same kind + board + actor within the same minute
  -- collapse into one row.
  bucket := floor(extract(epoch from now()) / 60)::bigint;
  bkey := concat_ws(
    ':',
    p_recipient::text,
    p_kind,
    coalesce(p_board::text, '-'),
    coalesce(p_actor::text, '-'),
    bucket::text
  );

  select id, payload into existing_id, existing_payload
  from public.notifications
  where bundle_key = bkey;

  if existing_id is not null then
    update public.notifications
      set
        payload = jsonb_set(
          coalesce(existing_payload, '{}'::jsonb),
          '{count}',
          to_jsonb(coalesce((existing_payload ->> 'count')::int, 1) + 1)
        ),
        read_at = null,
        created_at = now()
      where id = existing_id;
    return;
  end if;

  insert into public.notifications (
    recipient_user_id, kind, related_card_id, related_board_id,
    actor_user_id, payload, bundle_key
  ) values (
    p_recipient, p_kind, p_card, p_board, p_actor,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('count', 1),
    bkey
  );
end$$;

-- Switch the bulk-prone branches in handle_card_update_for_watchers
-- to use the bundled helper.
create or replace function public.handle_card_update_for_watchers()
returns trigger language plpgsql security definer set search_path = public
as $$
declare w record;
begin
  if old.archived is distinct from new.archived then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_bundled_notification(
        w.user_id,
        case when new.archived then 'card.archived' else 'card.unarchived' end,
        new.id, new.board_id, auth.uid(),
        jsonb_build_object('title', new.title)
      );
    end loop;
  end if;
  if (old.list_id is distinct from new.list_id) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_bundled_notification(
        w.user_id, 'card.moved', new.id, new.board_id, auth.uid(),
        jsonb_build_object('title', new.title)
      );
    end loop;
  end if;
  if (old.due_date is distinct from new.due_date)
     and new.due_date is not null then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.due', new.id, new.board_id, auth.uid(),
        jsonb_build_object('due_date', new.due_date, 'title', new.title)
      );
    end loop;
  end if;
  if (old.start_date is distinct from new.start_date)
     or (old.target_date is distinct from new.target_date) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.dates', new.id, new.board_id, auth.uid(),
        jsonb_build_object(
          'start_date', new.start_date,
          'target_date', new.target_date,
          'title', new.title
        )
      );
    end loop;
  end if;
  return new;
end$$;
