-- 0143 — per-workspace synthesis settings: report length + custom focus prompt.
--
-- Two new nullable columns on pma_workspace_state (the same operational table as
-- the report_sections selection, 0141):
--   * report_length — 'short' | 'medium' | 'long' (CHECK-enforced). null →
--     'medium', the current default, so the report stays byte-identical until a
--     workspace picks short/long.
--   * custom_prompt — free text appended to the synthesis prompt as an
--     EMPHASIS-ONLY focus directive (e.g. "focus on recent spine-keypoint
--     changes"). null/empty → no extra directive.
--
-- ADDITIVE ONLY: two new nullable columns on an existing table; no existing
-- column, row, or policy is touched. Like the rest of the PMA state layer, writes
-- are SERVICE-ROLE only (the run orchestrator saves the choice at run start);
-- members keep their existing SELECT — no new policy needed.

alter table public.pma_workspace_state
  add column report_length text check (report_length in ('short', 'medium', 'long')),
  add column custom_prompt text;
