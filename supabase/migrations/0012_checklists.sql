create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  position text not null,
  created_at timestamptz not null default now()
);
create index on public.checklists (board_id, card_id, position);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  position text not null,
  created_at timestamptz not null default now()
);
create index on public.checklist_items (board_id, checklist_id, position);

create or replace function public.set_checklist_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger checklists_set_board_id
  before insert or update of card_id on public.checklists
  for each row execute function public.set_checklist_board_id();

create or replace function public.set_checklist_item_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.checklists where id = new.checklist_id;
  if bid is null then raise exception 'checklist_id % not found', new.checklist_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger checklist_items_set_board_id
  before insert or update of checklist_id on public.checklist_items
  for each row execute function public.set_checklist_item_board_id();

alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;

create policy checklists_select on public.checklists for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklists.board_id and bm.user_id = auth.uid()
  ));
create policy checklists_member_write on public.checklists for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklists.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = checklists.card_id and bm.user_id = auth.uid()
  ));

create policy checklist_items_select on public.checklist_items for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklist_items.board_id and bm.user_id = auth.uid()
  ));
create policy checklist_items_member_write on public.checklist_items for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklist_items.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.checklists cl
    join public.board_members bm on bm.board_id = cl.board_id
    where cl.id = checklist_items.checklist_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.checklists;
alter publication supabase_realtime add table public.checklist_items;
