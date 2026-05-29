-- Workspace invitations: outstanding invites for new (or existing) users.
-- One row drives (a) the domain-hook carve-out, (b) the roster "Pending"
-- badge, (c) resend/revoke. See migration 0116 (carve-out) + 0117 (accept).

create table public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         public.workspace_role not null
                 check (role in ('admin','member','guest')),
  invited_by   uuid not null references public.profiles(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','accepted','revoked')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

create index workspace_invitations_workspace_idx
  on public.workspace_invitations (workspace_id);
create index workspace_invitations_email_idx
  on public.workspace_invitations (lower(email));

create unique index workspace_invitations_pending_uq
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

alter table public.workspace_invitations enable row level security;

create policy ws_invitations_select on public.workspace_invitations for select
  using (public.is_workspace_member(workspace_invitations.workspace_id, auth.uid()));

create policy ws_invitations_admin_write on public.workspace_invitations for all
  using (public.is_workspace_admin(workspace_invitations.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_invitations.workspace_id, auth.uid()));
