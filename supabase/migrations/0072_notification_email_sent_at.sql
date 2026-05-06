-- Track which notifications already had an email dispatched.  The
-- send-email worker (Vercel cron at /api/cron/send-emails) sets this
-- on success.  NULL means "not sent yet" or the recipient opted out.
alter table public.notifications
  add column if not exists email_sent_at timestamptz;

create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where email_sent_at is null;
