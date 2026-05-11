-- Add the two card audit tables (0089 sprint history, 0091 field
-- history) to the supabase_realtime publication so client-side
-- timeline / activity views echo cross-tab. Idempotent: each ALTER is
-- guarded by a pg_publication_tables existence check, so re-running
-- this migration on an environment that already has either table
-- published is a no-op.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'card_sprint_history'
  ) then
    alter publication supabase_realtime add table public.card_sprint_history;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'card_field_history'
  ) then
    alter publication supabase_realtime add table public.card_field_history;
  end if;
end$$;
