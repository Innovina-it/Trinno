create table public.activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  card_id uuid references public.cards(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity (board_id, created_at desc);
create index on public.activity (card_id, created_at desc) where card_id is not null;

alter table public.activity enable row level security;

create policy activity_select on public.activity for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = activity.board_id and bm.user_id = auth.uid())
    or exists (
      select 1 from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where b.id = activity.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy → only SECURITY DEFINER triggers can write.

alter publication supabase_realtime add table public.activity;
