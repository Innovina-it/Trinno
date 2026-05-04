-- card_components row's component must live on the same board as the
-- card. Without this CHECK a workspace member of board B who somehow
-- knows a component_id from board A could attach it (RLS gates the
-- destination but never validates the source). Blocks the attach at
-- the DB so application-layer drift can't reintroduce the gap.

create or replace function public.assert_card_component_same_board()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  comp_board uuid;
begin
  select board_id into comp_board from public.components where id = new.component_id;
  if comp_board is null then
    raise exception 'card_components: component_id % not found', new.component_id;
  end if;
  if comp_board <> new.board_id then
    raise exception 'card_components: component board % does not match card board %', comp_board, new.board_id;
  end if;
  return new;
end$$;

-- Fires after the existing set_card_component_board_id BEFORE trigger
-- has populated new.board_id from the card. Ordering: BEFORE triggers
-- run alphabetically, so prefix this trigger's name with z_ to ensure
-- it runs LAST among the BEFORE-INSERT triggers on this table.
create trigger z_card_components_same_board
  before insert or update of card_id, component_id on public.card_components
  for each row execute function public.assert_card_component_same_board();
