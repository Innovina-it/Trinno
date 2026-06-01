-- Fix regression from 0118: restricting workspace_invitations SELECT to
-- workspace admins broke inviteWorkspaceRedirect — an invitee (a non-admin
-- member) could no longer read their OWN invitation row to resolve the
-- post-accept redirect workspace, so the redirect silently returned null.
--
-- Add a permissive self-select policy: any user may read invitation rows that
-- name them (user_id = auth.uid()). This is OR'd with the admin SELECT policy,
-- so: admins read all invitations in their workspace; a non-admin reads ONLY
-- their own row. Other pending invitees' emails stay hidden from non-admins
-- (0118's intent is preserved — a member still can't enumerate others' rows).

create policy ws_invitations_select_own on public.workspace_invitations for select
  using (workspace_invitations.user_id = auth.uid());
