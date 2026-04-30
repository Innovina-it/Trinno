create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'comment.mention', 'comment.create',
    'card.assigned', 'card.unassigned',
    'card.archived', 'card.unarchived',
    'card.moved', 'card.due',
    'card.label.added',
    'board.member.added'
  )),
  payload jsonb not null default '{}'::jsonb,
  related_card_id uuid references public.cards(id) on delete set null,
  related_board_id uuid references public.boards(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient_user_id, created_at desc);
create index on public.notifications (recipient_user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_self_select on public.notifications for select
  using (recipient_user_id = auth.uid());

create policy notifications_self_update on public.notifications for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

create policy notifications_self_delete on public.notifications for delete
  using (recipient_user_id = auth.uid());

-- INSERT: only via SECURITY DEFINER triggers.

alter publication supabase_realtime add table public.notifications;
