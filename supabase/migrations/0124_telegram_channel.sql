-- 0124 (2026-06-05) - DB foundation for multi-channel notification delivery.
--
-- Two channel-generic tables (nothing wired to behavior yet):
--   * user_channel_links       : per-user external identity, channel-generic
--                                (e.g. a Telegram chat id), with a link-token
--                                handshake (pending -> linked -> revoked).
--   * notification_deliveries  : channel-neutral send ledger, one row per
--                                (notification, channel) attempt.
-- NOTE: the DB CHECK on user_notification_prefs.channel is widened to admit
-- 'telegram' in a follow-up migration (0125); 0124 only adds the tables and the
-- app-layer (Zod) channel enum.

create table public.user_channel_links (
  user_id         uuid not null references auth.users(id) on delete cascade,
  channel         text not null,
  external_id     text,
  link_token_hash text,
  link_token_exp  timestamptz,
  status          text not null default 'pending',  -- pending|linked|revoked
  linked_at       timestamptz,
  primary key (user_id, channel),
  unique (channel, external_id)
);

create table public.notification_deliveries (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel         text not null,
  status          text not null default 'pending',  -- pending|sent|skipped|failed
  attempts        int  not null default 0,
  sent_at         timestamptz,
  error           text,
  primary key (notification_id, channel)
);

create index on public.user_channel_links (channel, external_id);
create index on public.notification_deliveries (channel, status);

-- RLS: user_channel_links — a user may only touch their own rows.
alter table public.user_channel_links enable row level security;

create policy user_channel_links_select on public.user_channel_links for select
  using (user_id = auth.uid());

create policy user_channel_links_insert on public.user_channel_links for insert
  with check (user_id = auth.uid());

create policy user_channel_links_update on public.user_channel_links for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_channel_links_delete on public.user_channel_links for delete
  using (user_id = auth.uid());

-- RLS: notification_deliveries — service-role only. No user-facing policy;
-- the service role bypasses RLS, so enabling RLS with zero policies hides
-- the ledger from authenticated users entirely.
alter table public.notification_deliveries enable row level security;
