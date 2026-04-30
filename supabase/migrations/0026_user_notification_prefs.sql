create table public.user_notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('in_app', 'email', 'push')),
  enabled boolean not null default true,
  primary key (user_id, kind, channel)
);

alter table public.user_notification_prefs enable row level security;
create policy unp_self on public.user_notification_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
