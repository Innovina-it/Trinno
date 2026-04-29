create table public.comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.comments (board_id, card_id, created_at desc);

create or replace function public.set_comment_board_id()
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
create trigger comments_set_board_id
  before insert or update of card_id on public.comments
  for each row execute function public.set_comment_board_id();

alter table public.comments enable row level security;

create policy comments_select on public.comments for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = comments.board_id and bm.user_id = auth.uid()
  ));

-- INSERT: any board member, must use own user_id as author
create policy comments_member_insert on public.comments for insert
  with check (
    comments.author_id = auth.uid()
    and exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = comments.card_id and bm.user_id = auth.uid()
    )
  );

-- UPDATE/DELETE: author OR board admin
create policy comments_author_update on public.comments for update
  using (comments.author_id = auth.uid())
  with check (comments.author_id = auth.uid());

create policy comments_author_delete on public.comments for delete
  using (
    comments.author_id = auth.uid()
    or exists (
      select 1 from public.board_members bm
      where bm.board_id = comments.board_id
        and bm.user_id = auth.uid() and bm.role = 'admin'
    )
  );

alter publication supabase_realtime add table public.comments;
