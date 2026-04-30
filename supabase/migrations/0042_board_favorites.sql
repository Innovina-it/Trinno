-- Plan #16b-γ-C (#4) — per-user board favorites.
--
-- Composite PK on (user_id, board_id) so a single board can only be
-- favorited once per user. Cross-workspace by design — the nav dropdown
-- shows a flat "Favorites" list across the user's whole boards graph.
--
-- RLS: caller may only see / modify their own rows. Insert additionally
-- requires the user to be a board member; that's the permission gate
-- preventing a malicious caller from pinning private boards they
-- shouldn't see.

create table public.board_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

create index board_favorites_user_id_idx
  on public.board_favorites (user_id, created_at desc);

alter table public.board_favorites enable row level security;

create policy fav_select on public.board_favorites for select
  using (user_id = auth.uid());

create policy fav_insert on public.board_favorites for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.board_members bm
      where bm.board_id = board_favorites.board_id
        and bm.user_id = auth.uid()
    )
  );

create policy fav_delete on public.board_favorites for delete
  using (user_id = auth.uid());
