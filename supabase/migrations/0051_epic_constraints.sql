-- Plan #epic-as-kanban (Q10) — single-level epics. Epic cannot have an
-- epic as parent. Trigger enforces both directions: setting parent_card_id
-- on an epic, or flipping a card's type to 'epic' while it has an
-- epic-typed parent.

create or replace function public.cards_validate_epic_parent()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  parent_type text;
begin
  if new.parent_card_id is null then
    return new;
  end if;
  select type into parent_type from public.cards where id = new.parent_card_id;
  if new.type = 'epic' and parent_type = 'epic' then
    raise exception 'cards: epic cannot have an epic as parent';
  end if;
  return new;
end$$;

drop trigger if exists cards_validate_epic_parent_biu on public.cards;
create trigger cards_validate_epic_parent_biu
  before insert or update of parent_card_id, type on public.cards
  for each row execute function public.cards_validate_epic_parent();

-- Plan #epic-as-kanban (Q9) — auto co-locate child onto its epic-parent's
-- home board on parent set or change. Keeps the single-board-per-epic
-- mental model without needing a separate UI step.

create or replace function public.cards_co_locate_with_epic_parent()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  parent_board uuid;
  parent_type text;
begin
  if new.parent_card_id is null then
    return new;
  end if;
  select board_id, type into parent_board, parent_type
  from public.cards where id = new.parent_card_id;
  if parent_type = 'epic' and new.board_id <> parent_board then
    new.board_id := parent_board;
  end if;
  return new;
end$$;

drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
create trigger cards_co_locate_with_epic_parent_biu
  before insert or update of parent_card_id on public.cards
  for each row execute function public.cards_co_locate_with_epic_parent();
