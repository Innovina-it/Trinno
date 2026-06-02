-- 2026-06-02 — Gantt baselines. Immutable named captures of the roadmap's
-- scheduling data for live-vs-baseline comparison. Read = any workspace
-- member incl. guest; write = owner/admin. Captured child tables are
-- write-once (insert at capture, cascade-delete with the parent). No realtime
-- (immutable). Distinct from `versions` (releases) and `milestones`.

create table public.roadmap_baselines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  note         text,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index roadmap_baselines_ws_idx on public.roadmap_baselines (workspace_id, created_at desc);

create table public.roadmap_baseline_entries (
  baseline_id    uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id        uuid not null,
  title          text not null,
  start_date     timestamptz,
  target_date    timestamptz,
  completed_at   timestamptz,
  roadmap_order  integer,
  sprint_id      uuid,
  parent_card_id uuid,
  primary key (baseline_id, card_id)
);

create table public.roadmap_baseline_assignees (
  baseline_id uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id     uuid not null,
  user_id     uuid not null,
  primary key (baseline_id, card_id, user_id)
);

create table public.roadmap_baseline_milestones (
  baseline_id  uuid not null references public.roadmap_baselines(id) on delete cascade,
  milestone_id uuid not null,
  name         text not null,
  date         timestamptz,
  primary key (baseline_id, milestone_id)
);

alter table public.roadmap_baselines           enable row level security;
alter table public.roadmap_baseline_entries    enable row level security;
alter table public.roadmap_baseline_assignees  enable row level security;
alter table public.roadmap_baseline_milestones enable row level security;

create policy roadmap_baselines_select on public.roadmap_baselines for select
  using (public.is_workspace_member(roadmap_baselines.workspace_id, auth.uid()));
create policy roadmap_baselines_admin_write on public.roadmap_baselines for all
  using (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['roadmap_baseline_entries','roadmap_baseline_assignees','roadmap_baseline_milestones']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select using (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_member(b.workspace_id, auth.uid())));
      create policy %1$s_admin_write on public.%1$s for all using (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_admin(b.workspace_id, auth.uid())))
      with check (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_admin(b.workspace_id, auth.uid())));
    $f$, t);
  end loop;
end$$;
