create type public.sprint_state as enum ('planned', 'active', 'completed');

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  goal text,
  start_date timestamptz,
  end_date timestamptz,
  state public.sprint_state not null default 'planned',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.sprints (workspace_id, state);

-- One active sprint per workspace.
create unique index sprints_one_active_per_workspace
  on public.sprints (workspace_id)
  where state = 'active';

alter table public.cards
  add column sprint_id uuid references public.sprints(id) on delete set null;
create index on public.cards (sprint_id) where sprint_id is not null;

-- Trigger: card and sprint must share workspace.
create or replace function public.cards_validate_sprint()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  card_ws uuid;
  sprint_ws uuid;
begin
  if new.sprint_id is null then return new; end if;
  select w.id into card_ws
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
    where b.id = new.board_id;
  select workspace_id into sprint_ws from public.sprints where id = new.sprint_id;
  if sprint_ws is null then
    raise exception 'cards: sprint_id % not found', new.sprint_id;
  end if;
  if card_ws is null or card_ws <> sprint_ws then
    raise exception 'cards: sprint must be in the same workspace';
  end if;
  return new;
end$$;

create trigger cards_validate_sprint_biu
  before insert or update of sprint_id on public.cards
  for each row execute function public.cards_validate_sprint();

-- RLS for sprints: workspace members read; admins write.
alter table public.sprints enable row level security;

create policy sprints_select on public.sprints for select
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id and m.user_id = auth.uid())
  );

create policy sprints_admin_write on public.sprints for all
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id
              and m.user_id = auth.uid() and m.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id
              and m.user_id = auth.uid() and m.role in ('owner','admin'))
  );

alter publication supabase_realtime add table public.sprints;
