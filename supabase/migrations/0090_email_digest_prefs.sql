-- Daily email digest opt-in.
--
-- The existing `user_notification_prefs` table is shaped per-(user, kind,
-- channel) — fine for "do I get an email when someone @mentions me", but
-- a digest is global (all kinds, one daily summary). So we attach the
-- opt-in to `profiles` instead, mirroring the `onboarding_completed_at`
-- pattern from migration 0039.
--
-- Default OFF: users explicitly enable the digest at /settings/notifications.
-- The cron at /api/notifications/digest queries this column to decide who
-- gets a digest each day.

alter table public.profiles
  add column if not exists email_digest_optin boolean not null default false;

-- Partial index — the cron only ever queries WHERE email_digest_optin = true,
-- so a partial index on the (small) opted-in subset is the cheapest scan.
create index if not exists profiles_email_digest_optin_idx
  on public.profiles (id)
  where email_digest_optin = true;
