-- Skip all notifications for workspace guests.
--
-- Guests in a shared workspace are strictly read-only collaborators and
-- shouldn't be pinged by board activity (mentions, assignments,
-- card moves, due-date changes, member additions, etc.). Every
-- notification trigger funnels through `public.emit_notification`, so
-- adding a single short-circuit here covers every kind without touching
-- the per-trigger logic.
--
-- The notification's `related_board_id` resolves to its workspace via
-- the boards table; the workspace_members lookup then tells us whether
-- the recipient is a guest in that workspace. For the rare welcome
-- notification (board.member.added) the board_id is also present, so
-- this guard applies there too.

create or replace function public.emit_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if; -- skip self-notify

  -- #0111/0112 — workspace guests get no notifications.
  if p_board is not null then
    if exists (
      select 1
      from public.boards b
      join public.workspace_members wm
        on wm.workspace_id = b.workspace_id and wm.user_id = p_recipient
      where b.id = p_board and wm.role = 'guest'
    ) then
      return;
    end if;
  end if;

  insert into public.notifications (
    recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload
  ) values (p_recipient, p_kind, p_card, p_board, p_actor, coalesce(p_payload, '{}'::jsonb));
end$$;
