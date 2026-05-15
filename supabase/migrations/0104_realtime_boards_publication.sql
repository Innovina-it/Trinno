-- 2026-05-15 — Add the `boards` table to the supabase_realtime publication.
--
-- Without this, `BoardListRealtime` and `RoadmapView`'s
-- `postgres_changes` subscriptions for the `boards` table never receive
-- CDC events. Discovered during the testbed run when TB-12 ("new board
-- appears in other tabs without refresh") failed because the workspace
-- home + roadmap subscribers were silent. Manual fix on the local DB
-- unblocked TB-12; this migration ships the same change to every
-- environment.
--
-- Idempotent — Postgres errors with "duplicate table" if the table is
-- already in the publication, so wrap in a DO block that checks first.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'boards'
  ) then
    alter publication supabase_realtime add table boards;
  end if;
end$$;
