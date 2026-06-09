-- 2026-06-09 — PMA U12.12: per-range report dedup.
-- Record the analysis WINDOW + a content fingerprint on each run so a re-run of
-- the same date range can detect "nothing changed since the last report" and
-- point at the existing report instead of generating a duplicate.
--   window_start / window_end : the run's date window (NULL = whole-document run).
--   fingerprint               : { fileId: driveVersion } of the in-window files
--                               at run time; equal fingerprint + same window =>
--                               nothing changed since the previous report.
-- Additive + nullable. RLS unchanged (member SELECT / service-role write).

alter table public.pma_analysis_runs
  add column window_start timestamptz,
  add column window_end   timestamptz,
  add column fingerprint  jsonb;
