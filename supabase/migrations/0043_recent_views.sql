-- Plan #16b-γ-C (#5) — recently-viewed boards per user.
--
-- One row per (user, board); subsequent visits update `viewed_at` via
-- ON CONFLICT so the table stays bounded at workspace-board cardinality
-- per user. The nav dropdown reads the top 5 ordered by viewed_at desc.
--
-- RLS gates select/upsert to the row owner; nobody else ever sees a
-- user's view history.

create table public.recent_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

create index recent_views_user_id_viewed_at_idx
  on public.recent_views (user_id, viewed_at desc);

alter table public.recent_views enable row level security;

create policy rv_select on public.recent_views for select
  using (user_id = auth.uid());

create policy rv_upsert on public.recent_views for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
