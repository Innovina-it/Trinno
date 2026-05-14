-- 0103 - user preferences.
--
-- Forward-only and additive: add a per-user JSONB preference bag for app
-- shell and board-view UI state.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default jsonb_build_object(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy user_preferences_select on public.user_preferences for select
  using (user_id = auth.uid());

create policy user_preferences_insert on public.user_preferences for insert
  with check (user_id = auth.uid());

create policy user_preferences_update on public.user_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
