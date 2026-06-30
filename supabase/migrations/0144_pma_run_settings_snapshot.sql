-- 0144 — snapshot each analysis run's settings on its history row.
--
-- The Analysis history needs to show (and restore) the configuration that
-- produced each run: which sections, what length, what custom focus. The period
-- is already stored (window_start/end) and counts in `counts`; this adds the
-- rest as a single jsonb blob:
--   settings = { sections: {key:bool}|null, length: 'short'|'medium'|'long',
--                customPrompt: string|null }
-- null sections → all on (the run's effective default). null column → a run from
-- before this migration (its settings were never captured); the UI shows
-- "settings not recorded" for those and just opens the report.
--
-- ADDITIVE ONLY: one new nullable column on the append-only runs table. No
-- existing column, row, or policy is touched. Writes are service-role only (the
-- run orchestrator records the row), members keep their existing SELECT.

alter table public.pma_analysis_runs
  add column settings jsonb;
