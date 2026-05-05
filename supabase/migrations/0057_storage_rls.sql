-- Defense-in-depth storage RLS for the `card-attachments` bucket.
--
-- The upload route in app/api/upload/route.ts uses the service-role admin
-- client to write objects and to issue signed download URLs, so direct
-- client access to the bucket is not part of the happy path. These
-- policies block any attempt to call storage.objects from the anon /
-- authenticated client — only the service role bypasses RLS.

-- Enable RLS on storage.objects (Supabase enables it by default but be
-- explicit so this migration is correct under self-hosted setups too).
alter table storage.objects enable row level security;

-- Drop any prior permissive policies for this bucket (idempotent).
do $$
declare
  pol text;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'card_attachments_%'
  loop
    execute format('drop policy %I on storage.objects', pol);
  end loop;
end $$;

-- Default-deny: no read, no write, no delete from anon / authenticated.
-- (No CREATE POLICY = no rows pass RLS for those roles.)

-- Authenticated-only read fallback: a board member of the card the
-- attachment belongs to may read the object directly. Useful if the UI
-- ever switches off signed URLs for cached responses.
create policy card_attachments_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'card-attachments'
    and exists (
      select 1
      from public.attachments a
      join public.board_members bm on bm.board_id = a.board_id
      where a.storage_path = storage.objects.name
        and bm.user_id = auth.uid()
    )
  );
