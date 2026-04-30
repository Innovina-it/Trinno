create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  target_min int not null check (target_min > 0),
  applies_when jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.sla_policies (board_id);

create table public.card_sla (
  card_id uuid not null references public.cards(id) on delete cascade,
  sla_id uuid not null references public.sla_policies(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  started_at timestamptz not null default now(),
  breached_at timestamptz,
  resolved_at timestamptz,
  primary key (card_id, sla_id)
);
create index on public.card_sla (board_id) where breached_at is not null and resolved_at is null;

create or replace function public.set_card_sla_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_sla: card not found'; end if;
  new.board_id := bid;
  return new;
end$$;
create trigger card_sla_set_board_id
  before insert or update of card_id on public.card_sla
  for each row execute function public.set_card_sla_board_id();

alter table public.sla_policies enable row level security;
alter table public.card_sla enable row level security;

create policy sla_policies_select on public.sla_policies for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = sla_policies.board_id and bm.user_id = auth.uid())
  );

-- Only board admins or workspace owners/admins can edit SLAs.
create policy sla_policies_admin_write on public.sla_policies for all
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = sla_policies.board_id
              and bm.user_id = auth.uid() and bm.role = 'admin')
    or exists (select 1 from public.boards b
               join public.workspace_members wm on wm.workspace_id = b.workspace_id
               where b.id = sla_policies.board_id
                 and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.boards b
            join public.workspace_members wm on wm.workspace_id = b.workspace_id
            where b.id = sla_policies.board_id
              and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  );

create policy card_sla_select on public.card_sla for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = card_sla.board_id and bm.user_id = auth.uid())
  );

-- card_sla rows written only by SECURITY DEFINER scan helper. No user policy.

alter publication supabase_realtime add table public.card_sla;
