-- Audit found two tables missing from the realtime publication:
--
-- - public.board_members — without it, role changes and removals are
--   invisible to open browser tabs until a hard reload.  RLS on the
--   table already gates rows correctly; we just need to fire CDC.
--
-- - public.profiles — without it, display_name updates by user A never
--   reach user B's open tabs (comments, members panel, activity feed
--   all keep the stale name).
--
-- supabase_realtime is the default publication created by `supabase
-- start`; alter is idempotent across re-applies via the IF NOT EXISTS
-- check Postgres performs internally on identical alter publication.

alter publication supabase_realtime add table public.board_members;
alter publication supabase_realtime add table public.profiles;
