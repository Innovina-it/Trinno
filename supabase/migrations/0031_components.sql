-- 0031_components.sql — Components (board-scoped) + card_components junction (plan #10).
create table public.components (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  lead_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index components_board_name_unique on public.components (board_id, lower(name));
create index on public.components (board_id);

create table public.card_components (
  card_id uuid not null references public.cards(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, component_id)
);
create index on public.card_components (board_id);
create index on public.card_components (component_id);

-- Denorm board_id from cards on every insert/update of card_id.
create or replace function public.set_card_component_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end$$;
create trigger card_components_set_board_id
  before insert or update of card_id on public.card_components
  for each row execute function public.set_card_component_board_id();

alter table public.components enable row level security;
alter table public.card_components enable row level security;

-- READ: board members (or workspace members for workspace-visible boards)
create policy components_select on public.components for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

-- WRITE: board admins (or workspace owner/admin via existing escalation)
create policy components_admin_write on public.components for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ));

-- card_components: read = board members; write = board members
create policy card_components_select on public.card_components for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_components.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = card_components.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

create policy card_components_member_write on public.card_components for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_components.board_id and bm.user_id = auth.uid()
  ))
  with check (
    exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = card_components.card_id and bm.user_id = auth.uid()
    )
    and exists (
      -- Block cross-board attaches: the component must live on the card's board.
      select 1 from public.components co
      join public.cards c on c.id = card_components.card_id
      where co.id = card_components.component_id and co.board_id = c.board_id
    )
  );

alter publication supabase_realtime add table public.components;
alter publication supabase_realtime add table public.card_components;
