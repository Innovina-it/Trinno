-- 2026-06-07 — Second workspace-level link. A workspace can now hold TWO
-- Drive links: the existing Source ("Shared folder", cloud icon) and a new
-- OUTPUT/reports folder. Distinguished by a `purpose` discriminator.
-- Card-scope links are unaffected (purpose defaults to 'source' and the
-- card uniqueness index does not include it).

do $$ begin
  create type public.link_purpose as enum ('source','reports');
exception when duplicate_object then null;
end $$;

-- Default 'source' so existing rows (and all card-scope rows) backfill to the
-- current cloud-icon link with no change in behaviour.
alter table public.links
  add column if not exists purpose public.link_purpose not null default 'source';

-- Backfill is implicit via the default, but make it explicit for clarity and
-- to cover any pre-existing rows (workspace links → 'source').
update public.links set purpose = 'source' where purpose is null;

-- Uniqueness: one workspace link PER PURPOSE per workspace (was: one workspace
-- link per workspace). Drop the old single-column index and recreate it
-- including purpose, still scoped to workspace links only. The card index
-- (links_card_ux) is left untouched.
drop index if exists public.links_ws_ux;
create unique index links_ws_ux
  on public.links(workspace_id, purpose) where scope = 'workspace';
