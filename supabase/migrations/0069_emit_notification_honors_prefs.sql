-- Honor `user_notification_prefs.in_app` toggles in the
-- emit_notification helper.  Default behavior (no row in the prefs
-- table) stays enabled — opt-OUT only.  This means the existing UI
-- toggles in /settings/notifications now actually mute notifications
-- instead of being decorative.

create or replace function public.emit_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if;

  -- Per-user, per-kind opt-out.  A row with enabled = false silences
  -- this kind for this channel.  Absence of a row = enabled.
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
