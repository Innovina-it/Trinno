-- 2026-06-25 — PMA per-workspace report-section selection.
-- Adds report_sections to pma_workspace_state: a per-workspace map of which of
-- the synthesis report's sections to render (the checkboxes in the Run-analysis
-- panel). NULL → all sections on, which is the default and the state of every
-- workspace before this migration, so the report stays byte-identical to today
-- until a workspace saves a combination. A section renders UNLESS explicitly
-- false, so sections added later default on without touching saved rows.
--
-- ADDITIVE ONLY: one new nullable column on an existing operational table. No
-- existing column, row, or policy is touched, so this cannot break anything
-- already in the database. Like the rest of the PMA state layer (0131), writes
-- are SERVICE-ROLE only (the run orchestrator saves the combination at run
-- start); members keep their existing SELECT — no new policy is needed.

alter table public.pma_workspace_state
  add column report_sections jsonb;
