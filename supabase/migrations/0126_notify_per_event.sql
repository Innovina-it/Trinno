-- 0126 (2026-06-06) - "Notify me on every event" master toggle storage.
--
-- Backs the per-event delivery master switch defined in
-- docs/features/telegram-channel/U6-MASTER-TOGGLE-CONTRACT.md (§4). Gates
-- EXTERNAL channels (email + telegram) only; the in-app bell/inbox stays
-- always-on. Default OFF for everyone: today nothing can deliver (email send
-- unwired, telegram not yet linked), so off is the only honest default.
--
-- No backfill needed (the NOT NULL DEFAULT false covers existing rows) and no
-- new RLS — profiles already carries owner read/write RLS from 0003.

alter table public.profiles
  add column notify_per_event boolean not null default false;
