create table public.lists (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  position text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.lists (board_id, position);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  description text,
  position text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.cards (board_id, list_id, position);

create or replace function public.set_card_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  bid uuid;
begin
  select board_id into bid from public.lists where id = new.list_id;
  if bid is null then
    raise exception 'list_id % not found', new.list_id;
  end if;
  new.board_id := bid;
  return new;
end;
$$;

create trigger cards_set_board_id
  before insert or update of list_id on public.cards
  for each row execute function public.set_card_board_id();

alter table public.lists enable row level security;
alter table public.cards enable row level security;

create policy lists_select on public.lists for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = lists.board_id and bm.user_id = auth.uid())
    or exists (
      select 1 from public.boards b
      where b.id = lists.board_id and b.visibility = 'workspace'
        and exists (select 1 from public.workspace_members wm
                    where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid())
    )
  );

create policy cards_select on public.cards for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = cards.board_id and bm.user_id = auth.uid())
    or exists (
      select 1 from public.boards b
      where b.id = cards.board_id and b.visibility = 'workspace'
        and exists (select 1 from public.workspace_members wm
                    where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid())
    )
  );

create policy lists_member_write on public.lists for update
  using (exists (select 1 from public.board_members bm
                 where bm.board_id = lists.board_id and bm.user_id = auth.uid()))
  with check (exists (select 1 from public.board_members bm
                      where bm.board_id = lists.board_id and bm.user_id = auth.uid()));

create policy lists_member_delete on public.lists for delete
  using (exists (select 1 from public.board_members bm
                 where bm.board_id = lists.board_id and bm.user_id = auth.uid()));

create policy cards_member_write on public.cards for update
  using (exists (select 1 from public.board_members bm
                 where bm.board_id = cards.board_id and bm.user_id = auth.uid()))
  with check (exists (select 1 from public.board_members bm
                      where bm.board_id = cards.board_id and bm.user_id = auth.uid()));

create policy cards_member_delete on public.cards for delete
  using (exists (select 1 from public.board_members bm
                 where bm.board_id = cards.board_id and bm.user_id = auth.uid()));
