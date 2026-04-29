create table public.labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null default '',
  color text not null
);
create index on public.labels (board_id);

create table public.card_labels (
  card_id uuid not null references public.cards(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, label_id)
);
create index on public.card_labels (board_id);

create or replace function public.set_card_label_board_id()
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
create trigger card_labels_set_board_id
  before insert or update of card_id on public.card_labels
  for each row execute function public.set_card_label_board_id();

alter table public.labels enable row level security;
alter table public.card_labels enable row level security;

create policy labels_select on public.labels for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = labels.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));
create policy labels_member_write on public.labels for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ));

create policy card_labels_select on public.card_labels for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_labels.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = card_labels.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));
create policy card_labels_member_write on public.card_labels for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_labels.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = card_labels.card_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.labels;
alter publication supabase_realtime add table public.card_labels;
