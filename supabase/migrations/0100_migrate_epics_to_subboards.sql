-- 0100 - migrate Epic card containers to sub-boards.
--
-- Forward path:
--   1. Create one child board per existing type='epic' card.
--   2. Clone the parent board lists into each child board.
--   3. Move every descendant card into the child board. Direct epic
--      children become top-level cards; deeper descendants keep their
--      parent_card_id links.
--
-- Rollback path:
--   This repo uses forward-only Supabase SQL migrations (see 0096-0098),
--   so the down behavior is captured as a callable SQL function:
--     select public.rollback_epic_subboard_migration();

create table if not exists public.epic_subboard_migrations (
  epic_card_id uuid primary key references public.cards(id) on delete cascade,
  sub_board_id uuid not null unique references public.boards(id) on delete cascade,
  parent_board_id uuid not null references public.boards(id) on delete cascade,
  migrated_at timestamptz not null default now()
);

create table if not exists public.epic_subboard_migration_lists (
  sub_board_id uuid not null references public.boards(id) on delete cascade,
  source_list_id uuid not null references public.lists(id) on delete restrict,
  sub_list_id uuid not null unique references public.lists(id) on delete cascade,
  primary key (sub_board_id, source_list_id)
);

create table if not exists public.epic_subboard_migration_cards (
  epic_card_id uuid not null references public.cards(id) on delete cascade,
  sub_board_id uuid not null references public.boards(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  source_list_id uuid not null references public.lists(id) on delete restrict,
  depth int not null check (depth > 0),
  primary key (card_id)
);

alter table public.epic_subboard_migrations enable row level security;
alter table public.epic_subboard_migration_lists enable row level security;
alter table public.epic_subboard_migration_cards enable row level security;

do $$
declare
  direct_subtasks int;
begin
  select count(*) into direct_subtasks
  from public.cards child
  join public.cards epic on epic.id = child.parent_card_id
  where epic.type = 'epic'
    and child.type = 'subtask';

  if direct_subtasks > 0 then
    raise exception
      'epic-to-subboard migration blocked: % direct epic child cards are type=subtask',
      direct_subtasks;
  end if;
end$$;

with epic_cards as (
  select
    e.id as epic_card_id,
    e.title,
    e.created_at,
    e.board_id as parent_board_id,
    b.workspace_id,
    b.background_kind,
    b.background_value,
    b.visibility,
    b.created_by,
    b.archived
  from public.cards e
  join public.boards b on b.id = e.board_id
  where e.type = 'epic'
    and not exists (
      select 1
      from public.boards existing
      where existing._migrated_from_epic_id = e.id
    )
),
inserted_boards as (
  insert into public.boards (
    workspace_id,
    title,
    background_kind,
    background_value,
    visibility,
    created_by,
    archived,
    created_at,
    parent_board_id,
    _migrated_from_epic_id
  )
  select
    workspace_id,
    title,
    background_kind,
    background_value,
    visibility,
    created_by,
    archived,
    created_at,
    parent_board_id,
    epic_card_id
  from epic_cards
  returning id, parent_board_id, _migrated_from_epic_id
)
insert into public.epic_subboard_migrations (
  epic_card_id,
  sub_board_id,
  parent_board_id
)
select _migrated_from_epic_id, id, parent_board_id
from inserted_boards
on conflict (epic_card_id) do nothing;

insert into public.epic_subboard_migrations (
  epic_card_id,
  sub_board_id,
  parent_board_id
)
select
  b._migrated_from_epic_id,
  b.id,
  b.parent_board_id
from public.boards b
where b._migrated_from_epic_id is not null
  and b.parent_board_id is not null
on conflict (epic_card_id) do nothing;

insert into public.board_members (board_id, user_id, role)
select m.sub_board_id, bm.user_id, bm.role
from public.epic_subboard_migrations m
join public.board_members bm on bm.board_id = m.parent_board_id
on conflict do nothing;

with source_lists as (
  select
    m.sub_board_id,
    l.id as source_list_id,
    gen_random_uuid() as sub_list_id,
    l.title,
    l.position,
    l.archived,
    l.created_at,
    l.status_kind,
    l.color
  from public.epic_subboard_migrations m
  join public.lists l on l.board_id = m.parent_board_id
  where not exists (
    select 1
    from public.epic_subboard_migration_lists lm
    where lm.sub_board_id = m.sub_board_id
      and lm.source_list_id = l.id
  )
),
inserted_lists as (
  insert into public.lists (
    id,
    board_id,
    title,
    position,
    archived,
    created_at,
    status_kind,
    color
  )
  select
    sub_list_id,
    sub_board_id,
    title,
    position,
    archived,
    created_at,
    status_kind,
    color
  from source_lists
  returning id
)
insert into public.epic_subboard_migration_lists (
  sub_board_id,
  source_list_id,
  sub_list_id
)
select sub_board_id, source_list_id, sub_list_id
from source_lists
where sub_list_id in (select id from inserted_lists)
on conflict (sub_board_id, source_list_id) do nothing;

create temporary table epic_subboard_card_moves on commit drop as
with recursive descendants as (
  select
    m.epic_card_id,
    m.sub_board_id,
    c.id as card_id,
    c.list_id as source_list_id,
    1 as depth
  from public.epic_subboard_migrations m
  join public.cards c on c.parent_card_id = m.epic_card_id

  union all

  select
    d.epic_card_id,
    d.sub_board_id,
    c.id as card_id,
    c.list_id as source_list_id,
    d.depth + 1 as depth
  from descendants d
  join public.cards c on c.parent_card_id = d.card_id
  where d.depth < 1000
)
select *
from descendants;

insert into public.epic_subboard_migration_cards (
  epic_card_id,
  sub_board_id,
  card_id,
  source_list_id,
  depth
)
select epic_card_id, sub_board_id, card_id, source_list_id, depth
from epic_subboard_card_moves
on conflict (card_id) do nothing;

update public.cards c
set
  list_id = lm.sub_list_id,
  board_id = m.sub_board_id,
  parent_card_id = null
from epic_subboard_card_moves m
join public.epic_subboard_migration_lists lm
  on lm.sub_board_id = m.sub_board_id
 and lm.source_list_id = m.source_list_id
where c.id = m.card_id
  and m.depth = 1;

do $$
declare
  current_depth int := 2;
  max_depth int;
begin
  select coalesce(max(depth), 1) into max_depth
  from epic_subboard_card_moves;

  while current_depth <= max_depth loop
    update public.cards c
    set
      list_id = lm.sub_list_id,
      board_id = m.sub_board_id
    from epic_subboard_card_moves m
    join public.epic_subboard_migration_lists lm
      on lm.sub_board_id = m.sub_board_id
     and lm.source_list_id = m.source_list_id
    where c.id = m.card_id
      and m.depth = current_depth;

    current_depth := current_depth + 1;
  end loop;
end$$;

create or replace function public.rollback_epic_subboard_migration()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_depth int := 2;
  max_depth int;
begin
  drop table if exists pg_temp.rollback_epic_subboard_card_moves;

  create temporary table rollback_epic_subboard_card_moves on commit drop as
  select
    mc.epic_card_id,
    mc.sub_board_id,
    mc.card_id,
    mc.source_list_id,
    mc.depth,
    m.parent_board_id
  from public.epic_subboard_migration_cards mc
  join public.epic_subboard_migrations m
    on m.epic_card_id = mc.epic_card_id
   and m.sub_board_id = mc.sub_board_id
  order by mc.depth asc;

  update public.cards c
  set
    list_id = r.source_list_id,
    board_id = r.parent_board_id,
    parent_card_id = null
  from rollback_epic_subboard_card_moves r
  where c.id = r.card_id
    and r.depth = 1;

  select coalesce(max(depth), 1) into max_depth
  from rollback_epic_subboard_card_moves;

  while current_depth <= max_depth loop
    update public.cards c
    set
      list_id = r.source_list_id,
      board_id = r.parent_board_id
    from rollback_epic_subboard_card_moves r
    where c.id = r.card_id
      and r.depth = current_depth;

    current_depth := current_depth + 1;
  end loop;

  update public.cards c
  set parent_card_id = r.epic_card_id
  from rollback_epic_subboard_card_moves r
  where c.id = r.card_id
    and r.depth = 1;

  delete from public.epic_subboard_migration_cards mc
  using rollback_epic_subboard_card_moves r
  where mc.card_id = r.card_id;

  delete from public.boards b
  using public.epic_subboard_migrations m
  where b.id = m.sub_board_id
    and not exists (
      select 1
      from public.cards c
      where c.board_id = b.id
    );

  delete from public.epic_subboard_migrations m
  where not exists (
    select 1
    from public.boards b
    where b.id = m.sub_board_id
  );
end$$;

revoke all on function public.rollback_epic_subboard_migration() from public;
grant execute on function public.rollback_epic_subboard_migration() to service_role;
