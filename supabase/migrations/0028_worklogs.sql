create table public.worklogs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  user_id uuid not null references public.profiles(id) on delete restrict,
  minutes int not null check (minutes > 0 and minutes <= 100000),
  started_at timestamptz not null default now(),
  comment text,
  created_at timestamptz not null default now()
);
create index on public.worklogs (card_id, started_at desc);
create index on public.worklogs (board_id);

create or replace function public.set_worklog_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'worklogs: card not found'; end if;
  new.board_id := bid;
  return new;
end$$;

create trigger worklogs_set_board_id
  before insert or update of card_id on public.worklogs
  for each row execute function public.set_worklog_board_id();

-- Maintain cards.spent_min via aggregate after every change.
create or replace function public.recompute_card_spent_min()
returns trigger language plpgsql security definer set search_path = public
as $$
declare cid uuid := coalesce(new.card_id, old.card_id);
begin
  update public.cards
    set spent_min = coalesce(
      (select sum(minutes)::int from public.worklogs where card_id = cid),
      0
    )
    where id = cid;
  return null;
end$$;

create trigger worklogs_aud_recompute
  after insert or update or delete on public.worklogs
  for each row execute function public.recompute_card_spent_min();

alter table public.worklogs enable row level security;

create policy worklogs_select on public.worklogs for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = worklogs.board_id and bm.user_id = auth.uid())
  );
create policy worklogs_self_write on public.worklogs for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = worklogs.card_id and bm.user_id = auth.uid()
    )
  );
create policy worklogs_self_update on public.worklogs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy worklogs_self_delete on public.worklogs for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.worklogs;
