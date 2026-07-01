-- 0145 — run manager: durable, observable, cancellable analysis runs.
--
-- Today a run row is written only when the analysis FINISHES, so an in-flight run
-- is invisible and a refresh loses it. This makes the run a real job: it is
-- recorded the moment it starts (status 'running') and updated in place as it
-- works, so it survives refresh/navigation and can show live progress.
--
-- New columns on pma_analysis_runs:
--   started_at       — when the run began (run_at stays the completion/label time).
--   heartbeat_at     — bumped as the run works; a stale heartbeat means the
--                      process died (the orphan reaper marks such rows failed).
--   cancel_requested — set by the Cancel action; the run checks it between stages
--                      and files, then finishes with status 'cancelled'.
--   progress         — jsonb { stage, done, total, note } for the live indicator.
-- status also gains the values 'running' and 'cancelled' (text, no enum).
--
-- ADDITIVE ONLY: new nullable columns (+ one boolean default false) on the
-- append-only runs table. No existing column, row, or policy is touched. Writes
-- are service-role only (the orchestrator); members keep their SELECT.

alter table public.pma_analysis_runs
  add column started_at timestamptz,
  add column heartbeat_at timestamptz,
  add column cancel_requested boolean not null default false,
  add column progress jsonb;

-- Fast lookup of a workspace's in-flight run (concurrency guard + live UI).
create index pma_analysis_runs_running_idx
  on public.pma_analysis_runs (workspace_id)
  where status = 'running';
