-- Defense-in-depth storage RLS for the `card-attachments` bucket.
-- `storage.objects` is owned by `supabase_storage_admin`; if the migration
-- runner cannot create these policies, apply this file in Supabase Studio
-- SQL Editor during rollout.
--
-- The `card-attachments` bucket is private + server-side signed URLs are
-- the normal app path. These policies keep direct Storage API access scoped
-- to board members for paths under cards/<card_id>/.

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

-- Authenticated board members may upload directly under the card path.
-- This matches the app's storage path convention:
--   cards/<card_id>/<uuid>-<filename>
create policy card_attachments_member_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'card-attachments'
    and (storage.foldername(name))[1] = 'cards'
    and exists (
      select 1
      from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id::text = (storage.foldername(storage.objects.name))[2]
        and bm.user_id = auth.uid()
    )
  );

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
