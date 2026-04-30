-- 0035_gadgets.sql — Plan #16. Gadgets table + RLS (piggy-backs on dashboard ownership).
create table public.gadgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  type text not null check (type in (
    'count','recent_activity','assigned_to_me','due_this_week',
    'velocity','burndown','cards_by_type','markdown_note'
  )),
  config jsonb not null default '{}'::jsonb,
  position int not null default 0,
  size text not null default '1x1' check (size in ('1x1','2x1','2x2','3x1','3x2')),
  created_at timestamptz not null default now()
);
create index on public.gadgets (dashboard_id, position);

alter table public.gadgets enable row level security;

-- Read piggy-backs on dashboard read; write piggy-backs on dashboard ownership.
create policy gadgets_select on public.gadgets for select
  using (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id
      and (
        d.owner_id = auth.uid()
        or (d.scope = 'workspace' and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = d.workspace_id and wm.user_id = auth.uid()
        ))
      )
  ));

create policy gadgets_owner_write on public.gadgets for all
  using (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id and d.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id and d.owner_id = auth.uid()
  ));
