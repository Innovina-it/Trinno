create table public.card_members (
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, user_id)
);
create index on public.card_members (board_id);

create or replace function public.set_card_member_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger card_members_set_board_id
  before insert or update of card_id on public.card_members
  for each row execute function public.set_card_member_board_id();

alter table public.card_members enable row level security;

create policy card_members_select on public.card_members for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_members.board_id and bm.user_id = auth.uid()
  ));
create policy card_members_member_write on public.card_members for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_members.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = card_members.card_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.card_members;
