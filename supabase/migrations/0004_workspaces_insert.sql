-- Allow authenticated users to create workspaces they own,
-- and to bootstrap themselves as the owner member of those workspaces.
-- Without these, the create-workspace Server Action (insert workspaces +
-- insert owner membership row) is blocked by RLS for any user; only the
-- on_auth_user_created SECURITY DEFINER trigger could create them.

create policy workspaces_self_insert on public.workspaces for insert
  with check (owner_id = auth.uid());

-- The existing workspaces_member_select policy uses is_workspace_member,
-- which returns false during the create flow because the membership row is
-- inserted AFTER the workspace row. INSERT ... RETURNING re-checks SELECT,
-- so without owner-visibility the create action errors with a misleading
-- "new row violates row-level security policy" message. Owners must always
-- be able to see their own workspaces regardless of membership state.
create policy workspaces_owner_select on public.workspaces for select
  using (owner_id = auth.uid());

-- The existing ws_members_admin_write policy gates on is_workspace_admin,
-- which returns false during the bootstrap insert (no rows yet for the new
-- workspace). Allow the workspace owner to insert their own owner row,
-- which makes is_workspace_admin true for subsequent operations.
create policy ws_members_owner_bootstrap on public.workspace_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_members.workspace_id
        and w.owner_id = auth.uid()
    )
  );
