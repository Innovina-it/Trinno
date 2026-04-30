create type public.link_kind as enum (
  'blocks', 'is_blocked_by',
  'relates_to',
  'duplicates', 'is_duplicated_by'
);

create table public.card_links (
  id uuid primary key default gen_random_uuid(),
  from_card_id uuid not null references public.cards(id) on delete cascade,
  to_card_id   uuid not null references public.cards(id) on delete cascade,
  kind public.link_kind not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_card_id, to_card_id, kind),
  check (from_card_id <> to_card_id)
);
create index on public.card_links (board_id);
create index on public.card_links (from_card_id, kind);
create index on public.card_links (to_card_id, kind);

-- Denorm board_id from from_card on insert (single board per link)
create or replace function public.set_card_link_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  bid_from uuid;
  bid_to uuid;
begin
  select board_id into bid_from from public.cards where id = new.from_card_id;
  select board_id into bid_to   from public.cards where id = new.to_card_id;
  if bid_from is null or bid_to is null then
    raise exception 'card_links: missing card';
  end if;
  if bid_from <> bid_to then
    raise exception 'card_links: cards must share a board';
  end if;
  new.board_id := bid_from;
  return new;
end$$;
create trigger card_links_set_board_id
  before insert or update of from_card_id, to_card_id on public.card_links
  for each row execute function public.set_card_link_board_id();

-- Mirror inverse links automatically.
create or replace function public.mirror_card_link()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inverse public.link_kind;
begin
  inverse := case new.kind
    when 'blocks'             then 'is_blocked_by'::public.link_kind
    when 'is_blocked_by'      then 'blocks'::public.link_kind
    when 'duplicates'         then 'is_duplicated_by'::public.link_kind
    when 'is_duplicated_by'   then 'duplicates'::public.link_kind
    when 'relates_to'         then 'relates_to'::public.link_kind
  end;
  if inverse is null then return new; end if;
  insert into public.card_links (from_card_id, to_card_id, kind, board_id, created_by)
  values (new.to_card_id, new.from_card_id, inverse, new.board_id, new.created_by)
  on conflict (from_card_id, to_card_id, kind) do nothing;
  return new;
end$$;

create or replace function public.unmirror_card_link()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inverse public.link_kind;
begin
  inverse := case old.kind
    when 'blocks'             then 'is_blocked_by'::public.link_kind
    when 'is_blocked_by'      then 'blocks'::public.link_kind
    when 'duplicates'         then 'is_duplicated_by'::public.link_kind
    when 'is_duplicated_by'   then 'duplicates'::public.link_kind
    when 'relates_to'         then 'relates_to'::public.link_kind
  end;
  if inverse is null then return old; end if;
  delete from public.card_links
    where from_card_id = old.to_card_id
      and to_card_id   = old.from_card_id
      and kind         = inverse;
  return old;
end$$;

-- Use stmt-statement timing markers via session vars so the mirror itself
-- doesn't recurse infinitely. The conflict + delete-symmetry approach above
-- IS idempotent: mirroring a row that already has its inverse is a no-op
-- (ON CONFLICT DO NOTHING + the inverse delete only finds rows that exist).
create trigger card_links_mirror_aiu
  after insert on public.card_links
  for each row execute function public.mirror_card_link();
create trigger card_links_unmirror_ad
  after delete on public.card_links
  for each row execute function public.unmirror_card_link();

-- RLS: anyone who can read EITHER endpoint card can read the link.
alter table public.card_links enable row level security;

create policy card_links_select on public.card_links for select
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = card_links.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where b.id = card_links.board_id and b.visibility = 'workspace'
        and wm.user_id = auth.uid()
    )
  );

create policy card_links_member_write on public.card_links for all
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = card_links.board_id and bm.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.cards c
            join public.board_members bm on bm.board_id = c.board_id
            where c.id = card_links.from_card_id and bm.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.card_links;
