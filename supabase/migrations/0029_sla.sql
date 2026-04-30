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

-- SECURITY DEFINER function: scan a board for SLA breaches and insert/resolve
-- card_sla rows. Only board members may invoke (else returns 0 work).
create or replace function public.scan_board_sla(p_board_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_active int;
begin
  -- Caller must be a board member.
  if not exists (
    select 1 from public.board_members bm
    where bm.board_id = p_board_id and bm.user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;

  -- Resolve breaches for cards now archived.
  update public.card_sla cs
    set resolved_at = now()
    where cs.board_id = p_board_id
      and cs.resolved_at is null
      and exists (
        select 1 from public.cards c
        where c.id = cs.card_id and c.archived = true
      );

  -- Insert breach rows for each policy/card combo that crossed target.
  insert into public.card_sla (card_id, sla_id, board_id, started_at, breached_at)
  select c.id, p.id, c.board_id, c.created_at, now()
  from public.cards c
  join public.sla_policies p on p.board_id = c.board_id
  where p.board_id = p_board_id
    and p.enabled = true
    and c.archived = false
    and (extract(epoch from now() - c.created_at) / 60) > p.target_min
    and not exists (
      select 1 from public.card_sla cs
        where cs.card_id = c.id and cs.sla_id = p.id
    )
  on conflict (card_id, sla_id) do nothing;

  select count(*)::int into v_active
    from public.card_sla cs
    where cs.board_id = p_board_id
      and cs.resolved_at is null;

  return v_active;
end$$;

revoke all on function public.scan_board_sla(uuid) from public;
grant execute on function public.scan_board_sla(uuid) to authenticated;

alter publication supabase_realtime add table public.card_sla;
