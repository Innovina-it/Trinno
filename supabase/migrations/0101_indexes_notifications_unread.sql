-- 0101 - unread notification access path.
--
-- Forward-only and additive, matching the surrounding Supabase migration
-- convention: keep existing indexes in place and add the narrower unread
-- access path used by inbox/unread queries.

create index if not exists notifications_recipient_read_at_unread_created_idx
  on public.notifications (recipient_user_id, read_at, created_at desc)
  where read_at is null;
