-- supabase/migrations/0002_profile_trigger.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_workspace_id uuid;
  local_part text := split_part(new.email, '@', 1);
begin
  insert into public.profiles (id, display_name)
  values (new.id, local_part);

  insert into public.workspaces (name, owner_id)
  values (local_part || '''s Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
