create or replace function public.emit_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if;

  -- Cascading list/card deletes can fire dependent-row triggers after the
  -- referenced board/card row has already gone. Notifications carry foreign
  -- keys to those rows, so skip cascade noise instead of aborting the delete.
  if p_board is not null
    and not exists (select 1 from public.boards where id = p_board)
  then
    return;
  end if;

  if p_card is not null
    and not exists (select 1 from public.cards where id = p_card)
  then
    return;
  end if;

  -- Per-user, per-kind opt-out. A row with enabled = false silences this kind
  -- for this channel. Absence of a row = enabled.
  if exists (
    select 1 from public.user_notification_prefs unp
    where unp.user_id = p_recipient
      and unp.kind = p_kind
      and unp.channel = 'in_app'
      and unp.enabled = false
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload
  ) values (p_recipient, p_kind, p_card, p_board, p_actor, coalesce(p_payload, '{}'::jsonb));
end$$;

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

  -- Mirror emit_notification's cascade guards.
  if p_board is not null
    and not exists (select 1 from public.boards where id = p_board)
  then
    return;
  end if;

  if p_card is not null
    and not exists (select 1 from public.cards where id = p_card)
  then
    return;
  end if;

  -- Per-user opt-out.
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
