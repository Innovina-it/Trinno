-- Invite-email rate limiting (Resend free tier).
-- Two timestamps on workspace_invitations:
--   invite_email_sent_at : when the initial invite email went out (logging only)
--   reminder_sent_at     : when a "Resend invitation" reminder went out — logged
--                          AND counted to cap reminders at 4 per rolling hour.
-- The reminder path delivers via Resend (lib/invite-email.ts); brand-new invites
-- go through Supabase SMTP and are not counted. See actions/workspace-members.ts.

alter table public.workspace_invitations
  add column invite_email_sent_at timestamptz,
  add column reminder_sent_at     timestamptz;

-- Backs the rolling-hour count: select ... where reminder_sent_at > now() - '1 hour'.
create index workspace_invitations_reminder_sent_idx
  on public.workspace_invitations (reminder_sent_at);
