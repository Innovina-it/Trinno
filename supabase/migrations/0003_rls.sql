alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boards            enable row level security;
alter table public.board_members     enable row level security;

-- SECURITY DEFINER helpers to break RLS recursion when policies on a table
-- need to read that same table. These run as the function owner and bypass RLS.
create or replace function public.is_workspace_member(_workspace_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = _user_id
  );
$$;

create or replace function public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id
      and user_id = _user_id
      and role in ('owner','admin')
  );
$$;

create or replace function public.is_workspace_owner(_workspace_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id
      and user_id = _user_id
      and role = 'owner'
  );
$$;

create or replace function public.is_board_member(_board_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = _board_id and user_id = _user_id
  );
$$;

create or replace function public.is_board_admin(_board_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = _board_id and user_id = _user_id and role = 'admin'
  );
$$;

-- profiles: anyone authenticated can read profiles of workspace co-members; users update own
create policy profiles_self_select on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1 from public.workspace_members me
      where me.user_id = auth.uid()
        and public.is_workspace_member(me.workspace_id, profiles.id)
    )
  );

create policy profiles_self_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- workspaces: members read; owners/admins write
create policy workspaces_member_select on public.workspaces for select
  using (public.is_workspace_member(workspaces.id, auth.uid()));

create policy workspaces_owner_update on public.workspaces for update
  using (public.is_workspace_admin(workspaces.id, auth.uid()))
  with check (public.is_workspace_admin(workspaces.id, auth.uid()));

create policy workspaces_owner_delete on public.workspaces for delete
  using (public.is_workspace_owner(workspaces.id, auth.uid()));

-- workspace_members: members read; owners/admins write
create policy ws_members_select on public.workspace_members for select
  using (public.is_workspace_member(workspace_members.workspace_id, auth.uid()));

create policy ws_members_admin_write on public.workspace_members for all
  using (public.is_workspace_admin(workspace_members.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_members.workspace_id, auth.uid()));

-- boards: members read (or workspace member if visibility = 'workspace');
--         board admins or workspace owner/admin write
create policy boards_select on public.boards for select
  using (
    public.is_board_member(boards.id, auth.uid())
    or (
      boards.visibility = 'workspace'
      and public.is_workspace_member(boards.workspace_id, auth.uid())
    )
  );

create policy boards_admin_write on public.boards for all
  using (
    public.is_board_admin(boards.id, auth.uid())
    or public.is_workspace_admin(boards.workspace_id, auth.uid())
  )
  with check (
    public.is_board_admin(boards.id, auth.uid())
    or public.is_workspace_admin(boards.workspace_id, auth.uid())
  );

-- board_members: same gate as boards write
create policy board_members_select on public.board_members for select
  using (
    public.is_board_member(board_members.board_id, auth.uid())
    or exists (
      select 1 from public.boards b
      where b.id = board_members.board_id
        and public.is_workspace_member(b.workspace_id, auth.uid())
    )
  );

create policy board_members_admin_write on public.board_members for all
  using (
    public.is_board_admin(board_members.board_id, auth.uid())
    or exists (
      select 1 from public.boards b
      where b.id = board_members.board_id
        and public.is_workspace_admin(b.workspace_id, auth.uid())
    )
  )
  with check (
    public.is_board_admin(board_members.board_id, auth.uid())
    or exists (
      select 1 from public.boards b
      where b.id = board_members.board_id
        and public.is_workspace_admin(b.workspace_id, auth.uid())
    )
  );
