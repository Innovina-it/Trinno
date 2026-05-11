-- 0068's `dashboard_members_select` policy referenced `dashboard_members`
-- itself inside the EXISTS clause. Combined with `dashboards_select`
-- referencing `dashboard_members`, every read of dashboards (including
-- the implicit one fired by INSERT … RETURNING) hit a policy loop and
-- raised:
--   "infinite recursion detected in policy for relation dashboard_members"
--
-- Fix: simplify membership self-read to `user_id = auth.uid()` (any
-- user can see their own ACL row) and gate the rest via a SECURITY
-- DEFINER helper that bypasses RLS — matching the pattern from
-- migration 0003 (`is_workspace_member`, `is_board_member`).

create or replace function public.is_dashboard_owner(_dashboard_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dashboards d
    where d.id = _dashboard_id and d.owner_id = _user_id
  );
$$;

create or replace function public.is_workspace_dashboard(_dashboard_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dashboards d
    join public.workspace_members wm
      on wm.workspace_id = d.workspace_id
     and wm.user_id = _user_id
    where d.id = _dashboard_id
      and d.scope = 'workspace'
  );
$$;

drop policy if exists dashboard_members_select on public.dashboard_members;
create policy dashboard_members_select on public.dashboard_members for select
  using (
    -- Any user sees their own ACL rows.
    user_id = auth.uid()
    -- Owner sees the full ACL of their dashboard.
    or public.is_dashboard_owner(dashboard_members.dashboard_id, auth.uid())
    -- Workspace dashboards: workspace members see the ACL.
    or public.is_workspace_dashboard(dashboard_members.dashboard_id, auth.uid())
  );

-- Owner-write policy already uses a non-recursive EXISTS, but rewrite via
-- the helper for consistency.
drop policy if exists dashboard_members_owner_write on public.dashboard_members;
create policy dashboard_members_owner_write on public.dashboard_members for all
  using (public.is_dashboard_owner(dashboard_members.dashboard_id, auth.uid()))
  with check (public.is_dashboard_owner(dashboard_members.dashboard_id, auth.uid()));
