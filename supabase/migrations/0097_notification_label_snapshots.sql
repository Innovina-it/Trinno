-- 0097 — snapshot actor + target labels in notification payloads.
--
-- The inbox renders rows by left-joining notifications → profiles (actor)
-- and notifications → boards/cards (target). When the actor row is null
-- (auth.uid() unavailable at insert time — backfills, service-role inserts,
-- bootstrap scripts) or the target row is gone (board/card deleted, or
-- recipient no longer has RLS visibility), the join collapses to nulls and
-- the UI falls back to "Someone" and "—". The data needed to render the
-- row was correct at emit time; we just didn't keep it around.
--
-- Fix: stash a `board_title` (and where applicable `actor_name`) snapshot
-- in the notification payload at emit time, then read it as a fallback in
-- the renderer. Old rows are backfilled best-effort from the current state.
--
-- Scope of this migration: only the kinds that surface in the in-app inbox
-- and whose joins commonly degrade. Other kinds keep working off the join.

-- 1. board.member.added — extend the trigger to snapshot board title and
--    actor display_name into payload.
create or replace function public.handle_board_member_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_board_title text;
  v_actor_name  text;
begin
  select b.title into v_board_title
    from public.boards b where b.id = new.board_id;

  if auth.uid() is not null then
    select p.display_name into v_actor_name
      from public.profiles p where p.id = auth.uid();
  end if;

  perform public.emit_notification(
    new.user_id, 'board.member.added', null, new.board_id, auth.uid(),
    jsonb_build_object(
      'role', new.role,
      'board_title', v_board_title,
      'actor_name', v_actor_name
    )
  );
  return new;
end$$;

-- 2. Backfill existing board.member.added rows. Pull board title from the
--    current row (null if deleted) and actor name from the recorded
--    actor_user_id. Only fills keys that are not already present so we
--    don't overwrite anything richer that may have been stored.
update public.notifications n
   set payload = coalesce(payload, '{}'::jsonb)
                || case
                     when not (coalesce(payload, '{}'::jsonb) ? 'board_title')
                     then jsonb_build_object('board_title', b.title)
                     else '{}'::jsonb
                   end
                || case
                     when not (coalesce(payload, '{}'::jsonb) ? 'actor_name')
                     then jsonb_build_object(
                       'actor_name',
                       (
                         select p.display_name
                           from public.profiles p
                          where p.id = n.actor_user_id
                       )
                     )
                     else '{}'::jsonb
                   end
  from public.boards b
 where n.kind = 'board.member.added'
   and n.related_board_id = b.id
   and (
     not (payload ? 'board_title') or
     not (payload ? 'actor_name')
   );
