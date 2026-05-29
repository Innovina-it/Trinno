-- #2A: Restrict reading workspace_invitations to workspace admins/owner.
-- Previously any member could read pending invitee emails (and see the
-- pending badge). Tighten SELECT to is_workspace_admin. As a designed side
-- effect, listMembers' RLS-scoped left-join yields no invitation rows for
-- non-admins, so they no longer see the "Pending" badge.

drop policy if exists ws_invitations_select on public.workspace_invitations;
create policy ws_invitations_select on public.workspace_invitations for select
  using (public.is_workspace_admin(workspace_invitations.workspace_id, auth.uid()));
