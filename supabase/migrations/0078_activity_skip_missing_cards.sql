create or replace function public.log_activity(
  p_board_id uuid, p_card_id uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  -- Skip logging if the parent board no longer exists. This handles cascade
  -- deletes (board -> board_members/cards/comments/...) where AFTER DELETE
  -- triggers would otherwise violate the activity_board_id_fkey constraint.
  if not exists (select 1 from public.boards where id = p_board_id) then
    return;
  end if;

  -- During list/card cascades, dependent rows such as card_members can be
  -- deleted after the card row itself is already gone. Activity rows require
  -- card_id to reference an existing card, so card-scoped cascade noise must
  -- be skipped instead of aborting the parent delete.
  if p_card_id is not null
    and not exists (select 1 from public.cards where id = p_card_id)
  then
    return;
  end if;

  insert into public.activity (board_id, card_id, actor_id, type, payload)
  values (p_board_id, p_card_id, auth.uid(), p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;
