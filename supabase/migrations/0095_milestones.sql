-- Milestones: first-class roadmap date markers. Distinct from `versions`.
-- Each milestone belongs to a workspace and optionally scopes to a board.
-- RLS mirrors the workspace/board membership model used throughout the app.

create table if not exists public.milestones (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  board_id      uuid references public.boards(id) on delete set null,
  name          text not null,
  date          timestamptz not null,
  description   text,
  color         text not null default '#6366f1',
  icon          text,
  created_at    timestamptz not null default now(),
  created_by    uuid not null references public.profiles(id)
);

create index if not exists milestones_workspace_idx
  on public.milestones (workspace_id);

create index if not exists milestones_board_idx
  on public.milestones (board_id)
  where board_id is not null;

alter table public.milestones enable row level security;

-- SELECT: visible to any member of the workspace.
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select
  using (
    exists (
      select 1 from public.workspace_members wm
        where wm.workspace_id = milestones.workspace_id
          and wm.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: requires workspace admin OR board admin when boardId is set.
-- "workspace admin" = role in ('owner', 'admin') in workspace_members.
-- "board admin"     = role = 'admin' in board_members (only checked when board_id is not null).
drop policy if exists milestones_admin_write on public.milestones;
create policy milestones_admin_write on public.milestones
  for all
  using (
    exists (
      select 1 from public.workspace_members wm
        where wm.workspace_id = milestones.workspace_id
          and wm.user_id = auth.uid()
          and wm.role in ('owner', 'admin')
    )
    or (
      milestones.board_id is not null
      and exists (
        select 1 from public.board_members bm
          where bm.board_id = milestones.board_id
            and bm.user_id = auth.uid()
            and bm.role = 'admin'
      )
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
        where wm.workspace_id = milestones.workspace_id
          and wm.user_id = auth.uid()
          and wm.role in ('owner', 'admin')
    )
    or (
      milestones.board_id is not null
      and exists (
        select 1 from public.board_members bm
          where bm.board_id = milestones.board_id
            and bm.user_id = auth.uid()
            and bm.role = 'admin'
      )
    )
  );
