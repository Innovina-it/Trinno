create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes int not null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index on public.attachments (board_id, card_id);

create or replace function public.set_attachment_board_id()
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
create trigger attachments_set_board_id
  before insert or update of card_id on public.attachments
  for each row execute function public.set_attachment_board_id();

alter table public.attachments enable row level security;

create policy attachments_select on public.attachments for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = attachments.board_id and bm.user_id = auth.uid()
  ));
create policy attachments_member_insert on public.attachments for insert
  with check (
    attachments.uploaded_by = auth.uid()
    and exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = attachments.card_id and bm.user_id = auth.uid()
    )
  );
create policy attachments_member_delete on public.attachments for delete
  using (
    attachments.uploaded_by = auth.uid()
    or exists (
      select 1 from public.board_members bm
      where bm.board_id = attachments.board_id
        and bm.user_id = auth.uid() and bm.role = 'admin'
    )
  );

-- Bucket creation (idempotent). Storage RLS deferred -- table RLS gates registration.
insert into storage.buckets (id, name, public)
values ('card-attachments', 'card-attachments', false)
on conflict (id) do nothing;

alter publication supabase_realtime add table public.attachments;
