-- 0032_versions.sql — Versions (workspace-scoped) + card_versions junction (plan #10).
create type public.version_state as enum ('unreleased','released','archived');
create type public.card_version_kind as enum ('affects','fixes');

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  semver text,
  state public.version_state not null default 'unreleased',
  release_date timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index versions_workspace_name_unique on public.versions (workspace_id, lower(name));
create index on public.versions (workspace_id, state);

create table public.card_versions (
  card_id uuid not null references public.cards(id) on delete cascade,
  version_id uuid not null references public.versions(id) on delete cascade,
  kind public.card_version_kind not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  primary key (card_id, version_id, kind)
);
create index on public.card_versions (workspace_id);
create index on public.card_versions (version_id, kind);

-- Denorm workspace_id from cards.board_id → boards.workspace_id.
create or replace function public.set_card_version_workspace_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare wsid uuid;
begin
  select b.workspace_id into wsid
  from public.cards c
  join public.boards b on b.id = c.board_id
  where c.id = new.card_id;
  if wsid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.workspace_id := wsid;
  return new;
end$$;
create trigger card_versions_set_workspace_id
  before insert or update of card_id on public.card_versions
  for each row execute function public.set_card_version_workspace_id();

alter table public.versions enable row level security;
alter table public.card_versions enable row level security;

-- versions read: workspace members
create policy versions_select on public.versions for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid()
  ));

-- versions write: workspace owner/admin
create policy versions_admin_write on public.versions for all
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ));

-- card_versions read: workspace members of the card's workspace
create policy card_versions_select on public.card_versions for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = card_versions.workspace_id and wm.user_id = auth.uid()
  ));

-- card_versions write: any workspace member can attach versions to cards in boards in their workspace
create policy card_versions_member_write on public.card_versions for all
  using (exists (
    select 1 from public.cards c
    join public.boards b on b.id = c.board_id
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where c.id = card_versions.card_id and wm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.boards b on b.id = c.board_id
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where c.id = card_versions.card_id and wm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.versions;
alter publication supabase_realtime add table public.card_versions;
