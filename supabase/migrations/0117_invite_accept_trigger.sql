-- Mark a workspace invitation 'accepted' the moment the invitee confirms
-- their email (i.e. clicks the invite link and sets a password). Matches
-- by user_id OR email so it is robust whether or not user_id was stamped.
-- Consistent with the existing auth.users trigger (handle_new_user, 0110).

create or replace function public.handle_invite_accept()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then
    update public.workspace_invitations
       set status = 'accepted',
           accepted_at = now()
     where status = 'pending'
       and (user_id = new.id or lower(email) = lower(new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  execute function public.handle_invite_accept();
