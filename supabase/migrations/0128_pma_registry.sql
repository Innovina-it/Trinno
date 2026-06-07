-- 2026-06-07 — PMA (Project Management Assistant) Postgres data layer.
-- Registry + run-history index ONLY (DESIGN §4.3, §4.4, §4.6). KEYS / KIND /
-- POINTERS — NO bulk content: recap and report TEXT live in the Drive OUTPUT
-- folder (the system of record); Postgres is a rebuildable projection of Drive.
--
--   * pma_file_registry  : one row per source-folder file, keyed on the stable
--                          Drive fileId. Powers the cheap version gate,
--                          deletion/orphan detection, idempotency. Rebuildable
--                          by listing the Source + Output Drive folders.
--   * pma_analysis_runs  : run-history index for the Analysis tab. One row per
--                          "Run analysis", pointing at the report Google Doc in
--                          the Output folder via report_web_view_link.
--
-- RLS is workspace-scoped on both: SELECT for any workspace member (the
-- Analysis tab lists runs); writes are server-managed (the run orchestrator
-- runs service-role and bypasses RLS), so no user-facing write policy is
-- granted — mirroring notification_deliveries (0124). closed string sets use
-- text + CHECK, the repo's convention (0125, 0035, 0001).

create table public.pma_file_registry (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  source_file_id   text not null,                     -- Drive fileId in the SOURCE folder
  name             text,
  parent_folder_id text,
  mime_type        text,
  kind             text check (kind in ('editable','non_mod')),
  is_deliverable   boolean not null default false,
  card_link_id     uuid references public.links(id) on delete set null,
  last_version     text,                              -- headRevisionId — the version-gate checkpoint
  last_analyzed_at timestamptz,
  state            text not null default 'active' check (state in ('active','removed','error')),
  recap_file_id    text,                              -- Drive fileId of the latest recap in the OUTPUT folder
  updated_at       timestamptz not null default now(),
  unique (workspace_id, source_file_id)
);
create index pma_file_registry_ws_idx on public.pma_file_registry (workspace_id);

create table public.pma_analysis_runs (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  run_at               timestamptz not null default now(),
  triggered_by         uuid references auth.users(id) on delete set null,
  status               text,
  counts               jsonb,                          -- { changed, missed, removed }
  report_file_id       text,                           -- Drive fileId of the report Google Doc
  report_web_view_link text                            -- webViewLink the Analysis tab surfaces
);
create index pma_analysis_runs_ws_run_idx on public.pma_analysis_runs (workspace_id, run_at desc);

-- RLS — workspace-scoped. Members may read; writes are service-role only
-- (no user-facing write policy → authenticated users can read but never write).
alter table public.pma_file_registry enable row level security;
alter table public.pma_analysis_runs enable row level security;

create policy pma_file_registry_select on public.pma_file_registry for select
  using (public.is_workspace_member(pma_file_registry.workspace_id, auth.uid()));

create policy pma_analysis_runs_select on public.pma_analysis_runs for select
  using (public.is_workspace_member(pma_analysis_runs.workspace_id, auth.uid()));
