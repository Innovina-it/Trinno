-- 2026-06-02 — Link entity. One URL per card (coloured diamond) and one
-- URL per workspace (cloud icon). Read = any workspace member incl. guest.
-- Write = owner/admin only (RLS + a TS guard at the action layer).
-- Distinct from card_links (card-to-card relations).

do $$ begin
  create type public.link_scope as enum ('workspace','card');
exception when duplicate_object then null;
end $$;

create table public.links (
  id           uuid primary key default gen_random_uuid(),
  scope        public.link_scope not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id      uuid references public.cards(id) on delete cascade,
  url          text not null,
  color        text,                       -- card scope only; null for workspace
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint links_scope_shape check (
    (scope = 'workspace' and card_id is null and color is null) or
    (scope = 'card'      and card_id is not null)
  )
);

-- 1:1 per owner
create unique index links_ws_ux   on public.links(workspace_id) where scope = 'workspace';
create unique index links_card_ux on public.links(card_id)      where scope = 'card';
create index links_card_ws_idx on public.links(workspace_id) where scope = 'card';

-- Resolve + denormalise workspace_id for card-scope links from the card's
-- board, and keep updated_at fresh. Mirrors the card_links board_id trigger.
create or replace function public.links_set_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.scope = 'card' then
    -- always derive (overwrite any caller-supplied value) for card-scope links
    select b.workspace_id into new.workspace_id
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.id = new.card_id;
    if new.workspace_id is null then
      raise exception 'links: cannot resolve workspace for card %', new.card_id;
    end if;
  end if;
  return new;
end$$;

drop trigger if exists links_set_workspace_id_biu on public.links;
create trigger links_set_workspace_id_biu
  before insert or update on public.links
  for each row execute function public.links_set_workspace_id();

-- RLS
alter table public.links enable row level security;

create policy links_select on public.links for select
  using (public.is_workspace_member(links.workspace_id, auth.uid()));

create policy links_admin_write on public.links for all
  using (public.is_workspace_admin(links.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(links.workspace_id, auth.uid()));

-- Realtime: emit full row on delete + add to publication (idempotent).
alter table public.links replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'links'
  ) then
    alter publication supabase_realtime add table public.links;
  end if;
end$$;
