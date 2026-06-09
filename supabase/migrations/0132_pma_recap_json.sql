-- 2026-06-09 — PMA U12.1: store the structured per-file recap in Postgres.
-- Until now the recap JSON was written to the Drive OUTPUT folder
-- (recaps/{fileId}__{version}.json) and Postgres held only a pointer
-- (recap_file_id). U12.1 moves the recap BODY into Postgres: the registry row
-- now carries the full structured recap as jsonb. recap_file_id is retained for
-- back-compat but is NO LONGER written. This intentionally relaxes the
-- "registry rebuildable purely by listing Drive" invariant for recaps
-- (DESIGN §4.2/§4.3): recap bodies now live in Postgres; the analyses/ report
-- Docs remain the Drive system-of-record.
--
-- Additive + nullable: existing rows get NULL (no backfill). RLS unchanged — the
-- table's member-SELECT / service-role-write policies already cover the new
-- column. recap_json is project-analysis content, readable by workspace members
-- exactly like the run history that links to it.

alter table public.pma_file_registry
  add column recap_json jsonb;
