-- 2026-06-07 — Roadmap baseline "Approved" marker. Marks exactly ONE
-- roadmap_baseline per workspace as the approved plan-of-record. The partial
-- unique index enforces the at-most-one-approved-per-workspace invariant at
-- the DB level. Write gating (who can flip is_approved) is already covered by
-- the existing `roadmap_baselines_admin_write` policy (FOR ALL,
-- is_workspace_admin) from 0122 — UPDATE is included in FOR ALL — so no new
-- policy is needed here.

alter table public.roadmap_baselines
  add column is_approved boolean not null default false;

-- At most one approved baseline per workspace. Partial index only covers the
-- approved rows, so multiple unapproved baselines per workspace are fine.
create unique index roadmap_baselines_one_approved_idx
  on public.roadmap_baselines (workspace_id)
  where is_approved;
