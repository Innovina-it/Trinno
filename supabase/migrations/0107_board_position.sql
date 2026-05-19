-- 0107 - per-workspace board ordering.
--
-- Adds an integer `position` to public.boards so users can drag-reorder
-- boards on /w/[workspaceId]/boards. Lower position sorts first.
--
-- Backfill seeds positions in created-at-desc order (the prior implicit
-- order) with 1024-unit gaps per workspace. New rows get max+1024 via
-- the app; explicit drag-reorder renumbers the affected workspace.

alter table public.boards
  add column if not exists position integer not null default 0;

update public.boards b
set position = sub.rn * 1024
from (
  select id,
         row_number() over (partition by workspace_id order by created_at desc) as rn
  from public.boards
) sub
where b.id = sub.id;

create index if not exists boards_workspace_position_idx
  on public.boards (workspace_id, position);
