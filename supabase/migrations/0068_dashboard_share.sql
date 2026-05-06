-- Dashboard sharing.  Until now a dashboard was either personal
-- (owner-only) or workspace-scope (every workspace member could read,
-- only the owner could edit).  This migration adds a per-user ACL via
-- `dashboard_members` so a personal dashboard can be shared with
-- specific people, and so a workspace dashboard can have explicit
-- co-editors who aren't the owner.
--
-- Roles:
--   - viewer: SELECT-only.  Mirrors what workspace members already get
--             on workspace-scope dashboards.
--   - editor: SELECT + UPDATE the dashboard, plus full CRUD on its
--             gadgets.  Cannot delete the dashboard itself; only the
--             owner can.

create type public.dashboard_role as enum ('viewer', 'editor');

create table public.dashboard_members (
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.dashboard_role not null default 'viewer',
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (dashboard_id, user_id)
);
create index dashboard_members_user_idx on public.dashboard_members (user_id);

alter table public.dashboard_members enable row level security;

-- Reading the ACL is the same scope as reading the dashboard.
create policy dashboard_members_select on public.dashboard_members for select
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = dashboard_members.dashboard_id
        and (
          d.owner_id = auth.uid()
          or exists (
            select 1 from public.dashboard_members me
            where me.dashboard_id = d.id and me.user_id = auth.uid()
          )
          or (d.scope = 'workspace' and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = d.workspace_id and wm.user_id = auth.uid()
          ))
        )
    )
  );

-- Only the owner manages share grants.
create policy dashboard_members_owner_write on public.dashboard_members for all
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = dashboard_members.dashboard_id and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = dashboard_members.dashboard_id and d.owner_id = auth.uid()
    )
  );

-- Extend dashboards SELECT: also reachable via dashboard_members.
drop policy if exists dashboards_select on public.dashboards;
create policy dashboards_select on public.dashboards for select
  using (
    dashboards.owner_id = auth.uid()
    or exists (
      select 1 from public.dashboard_members dm
      where dm.dashboard_id = dashboards.id and dm.user_id = auth.uid()
    )
    or (dashboards.scope = 'workspace' and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = dashboards.workspace_id and wm.user_id = auth.uid()
    ))
  );

-- Extend dashboards UPDATE: editor role can rename / re-arrange.  Owner
-- still required for delete (existing policy is left as is).
drop policy if exists dashboards_owner_update on public.dashboards;
create policy dashboards_owner_or_editor_update on public.dashboards for update
  using (
    dashboards.owner_id = auth.uid()
    or exists (
      select 1 from public.dashboard_members dm
      where dm.dashboard_id = dashboards.id
        and dm.user_id = auth.uid()
        and dm.role = 'editor'
    )
  )
  with check (
    dashboards.owner_id = auth.uid()
    or exists (
      select 1 from public.dashboard_members dm
      where dm.dashboard_id = dashboards.id
        and dm.user_id = auth.uid()
        and dm.role = 'editor'
    )
  );

-- Gadgets: existing policy gates writes to the dashboard owner only.
-- Extend it so editors can manage gadgets too.
drop policy if exists gadgets_owner_write on public.gadgets;
create policy gadgets_owner_or_editor_write on public.gadgets for all
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = gadgets.dashboard_id
        and (
          d.owner_id = auth.uid()
          or exists (
            select 1 from public.dashboard_members dm
            where dm.dashboard_id = d.id
              and dm.user_id = auth.uid()
              and dm.role = 'editor'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = gadgets.dashboard_id
        and (
          d.owner_id = auth.uid()
          or exists (
            select 1 from public.dashboard_members dm
            where dm.dashboard_id = d.id
              and dm.user_id = auth.uid()
              and dm.role = 'editor'
          )
        )
    )
  );

-- Realtime: dashboard_members + dashboards both emit CDC so the share
-- dialog updates concurrently and recipients see new dashboards.
alter publication supabase_realtime add table public.dashboard_members;
alter publication supabase_realtime add table public.dashboards;
