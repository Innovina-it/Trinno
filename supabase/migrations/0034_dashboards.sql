-- 0034_dashboards.sql — Plan #16. Dashboards table + RLS.
create type public.dashboard_scope as enum ('personal','workspace');

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scope public.dashboard_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'personal' and workspace_id is null)
    or (scope = 'workspace' and workspace_id is not null)
  )
);
create index on public.dashboards (owner_id) where scope = 'personal';
create index on public.dashboards (workspace_id) where scope = 'workspace';

alter table public.dashboards enable row level security;

-- READ: owner OR (workspace dashboard AND user is workspace member)
create policy dashboards_select on public.dashboards for select
  using (
    dashboards.owner_id = auth.uid()
    or (dashboards.scope = 'workspace' and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = dashboards.workspace_id and wm.user_id = auth.uid()
    ))
  );

-- INSERT: owner_id must equal caller; workspace dashboards require workspace membership.
create policy dashboards_owner_insert on public.dashboards for insert
  with check (
    dashboards.owner_id = auth.uid()
    and (
      dashboards.scope = 'personal'
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = dashboards.workspace_id and wm.user_id = auth.uid()
      )
    )
  );

-- UPDATE / DELETE: only owner.
create policy dashboards_owner_update on public.dashboards for update
  using (dashboards.owner_id = auth.uid())
  with check (dashboards.owner_id = auth.uid());
create policy dashboards_owner_delete on public.dashboards for delete
  using (dashboards.owner_id = auth.uid());
