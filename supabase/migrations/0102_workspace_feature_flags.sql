-- 0102 - workspace feature flags.
--
-- Forward-only and additive: add a per-workspace JSONB flag bag used for
-- staged workspace-scoped rollouts.

alter table public.workspaces
  add column if not exists feature_flags jsonb not null default jsonb_build_object();
