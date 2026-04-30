-- supabase/migrations/0018_card_types.sql
alter table public.cards
  add column type text not null default 'task'
    check (type in ('epic','story','task','subtask','bug')),
  add column parent_card_id uuid references public.cards(id) on delete set null;

create index on public.cards (parent_card_id) where parent_card_id is not null;
create index on public.cards (board_id, type);

-- Subtasks must have a parent. Other types may not.
alter table public.cards add constraint cards_subtask_parent_check
  check (
    (type = 'subtask' and parent_card_id is not null)
    or (type <> 'subtask')
  );

-- Cycle / cross-board prevention. Walk ancestors; abort on self or board mismatch.
create or replace function public.cards_validate_parent()
returns trigger language plpgsql as $$
declare
  cur uuid := new.parent_card_id;
  parent_board uuid;
  hops int := 0;
begin
  if cur is null then return new; end if;
  loop
    if cur = new.id then
      raise exception 'cards: parent cycle detected';
    end if;
    select board_id, parent_card_id into parent_board, cur from public.cards where id = cur;
    if parent_board is null then
      raise exception 'cards: parent_card_id % not found', new.parent_card_id;
    end if;
    if parent_board <> new.board_id then
      raise exception 'cards: parent must be in same board';
    end if;
    hops := hops + 1;
    if hops > 1000 then
      raise exception 'cards: parent chain too deep';
    end if;
    exit when cur is null;
  end loop;
  return new;
end$$;

create trigger cards_validate_parent_biu
  before insert or update of parent_card_id, board_id on public.cards
  for each row execute function public.cards_validate_parent();
