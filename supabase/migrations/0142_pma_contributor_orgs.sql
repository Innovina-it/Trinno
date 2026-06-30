-- 0142 — per-workspace contributor → organization map (PMA report attribution).
--
-- PMA analysis reports today attribute each document change to the PERSON who
-- last edited it (Drive displayName, bolded in the report). This table lets a
-- workspace map a contributor to their ORGANIZATION so the report credits the
-- org instead of the individual. The map is maintained by hand in the workspace
-- Settings UI ("Organizations" section); a contributor with no row falls back to
-- their name verbatim, so an EMPTY map leaves every report byte-identical to
-- today — there is no behaviour change until a workspace fills the table in.
--
-- identity_kind/identity_key is the match key: 'email' (lowercased Drive
-- emailAddress — the stable identity) is preferred, else 'name' (trimmed Drive
-- displayName). display_name is the last-seen name, shown in the settings table.
--
-- ADDITIVE ONLY: a brand-new table; no existing table, row, or policy is
-- touched, so this cannot break anything already in the database. RLS mirrors
-- workspace_holidays (0108): members read, owners + admins write — because,
-- unlike the rest of the PMA layer (service-role-only writes), this map is
-- user-edited from the app.

create table public.pma_contributor_orgs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  identity_kind text not null check (identity_kind in ('email', 'name')),
  identity_key  text not null,
  display_name  text,
  org           text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, identity_kind, identity_key)
);

create index pma_contributor_orgs_workspace_idx
  on public.pma_contributor_orgs (workspace_id);

-- Touch updated_at on every update (mirrors workspace_holidays).
create or replace function public.pma_contributor_orgs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

create trigger pma_contributor_orgs_touch_updated_at_biu
  before update on public.pma_contributor_orgs
  for each row execute function public.pma_contributor_orgs_touch_updated_at();

-- RLS: workspace members read, owners + admins write.
alter table public.pma_contributor_orgs enable row level security;

create policy pma_contributor_orgs_select on public.pma_contributor_orgs for select
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = pma_contributor_orgs.workspace_id
              and m.user_id = auth.uid())
  );

create policy pma_contributor_orgs_admin_write on public.pma_contributor_orgs for all
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = pma_contributor_orgs.workspace_id
              and m.user_id = auth.uid()
              and m.role in ('owner', 'admin'))
  )
  with check (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = pma_contributor_orgs.workspace_id
              and m.user_id = auth.uid()
              and m.role in ('owner', 'admin'))
  );
