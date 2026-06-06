-- 0127 (2026-06-06) - Capture the Telegram @handle on link rows.
--
-- We store the chat_id (external_id) on link completion but not the user's
-- Telegram @username, so the settings UI can only show "Connected" instead of
-- "@handle · Connected". Add a nullable handle column the webhook fills from
-- message.from.username when it completes a /start link.
--
-- Nullable, no default, no backfill (existing rows simply have no handle until
-- the user re-links) and no new RLS — user_channel_links already carries its
-- owner read policy from 0124.

alter table public.user_channel_links
  add column handle text;
