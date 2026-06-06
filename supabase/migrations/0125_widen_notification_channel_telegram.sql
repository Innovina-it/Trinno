-- 0125 (2026-06-06) - Widen user_notification_prefs channel allow-list to admit 'telegram'.
--
-- Migration 0026 created user_notification_prefs_channel_check as
--   check (channel in ('in_app','email','push')).
-- 0124 added the telegram tables and widened the app-layer (Zod) channel enum,
-- but never altered this DB CHECK — so an enabled channel='telegram' pref row was
-- rejected at the database, making the Telegram delivery opt-in unreachable.
-- This widens the constraint to include 'telegram'. Forward-only, additive.

alter table public.user_notification_prefs
  drop constraint if exists user_notification_prefs_channel_check;

alter table public.user_notification_prefs
  add constraint user_notification_prefs_channel_check
  check (channel in ('in_app', 'email', 'push', 'telegram'));
