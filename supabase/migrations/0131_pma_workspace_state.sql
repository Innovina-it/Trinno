-- 2026-06-08 — PMA workspace state: per-workspace operational keys (DESIGN §4.5).
-- Holds the Drive Changes API checkpoint (changes_page_token) so a "Run
-- analysis" is INCREMENTAL — it processes only what changed since the previous
-- run, then saves the new token at run end as an idempotent checkpoint. One row
-- per workspace.
--
-- ADDITIVE ONLY: a brand-new table. No existing table, column, row, or policy is
-- touched, so this cannot break anything already in the database. Like the rest
-- of the PMA Postgres layer (0128), writes are SERVICE-ROLE only (the run
-- orchestrator runs outside any user session and bypasses RLS) — members may
-- read, no user-facing write policy is granted. No bulk content: a single token.

create table public.pma_workspace_state (
  workspace_id       uuid primary key references public.workspaces(id) on delete cascade,
  changes_page_token text,                                  -- Drive Changes API checkpoint
  updated_at         timestamptz not null default now()
);

alter table public.pma_workspace_state enable row level security;

create policy pma_workspace_state_select on public.pma_workspace_state for select
  using (public.is_workspace_member(pma_workspace_state.workspace_id, auth.uid()));
