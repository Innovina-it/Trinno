-- Personal workspace: auto-assign the creator to new cards by default.
--
-- Background: `workspaces.auto_assign_creator` exists since #0050 and
-- `createCardImpl` honors it (actions/cards.ts) — when true, the creator
-- is inserted into card_members at create time, unless the card has a
-- parent (subtasks inherit the parent's assignees, which still takes
-- precedence). The column defaults to false, so out of the box no
-- workspace auto-assigns.
--
-- Goal: turn this on for each user's "personal" workspace — the one
-- created by handle_new_user() at signup — both for existing users
-- (backfill) and for future signups (trigger).
--
-- "Personal" heuristic (we don't have an explicit is_personal column):
--   - per owner_id, the OLDEST workspace they own
--   - AND that workspace currently has exactly one workspace_members row
--     (the owner alone). This avoids hijacking team workspaces that
--     happen to be the user's first one ever.
--
-- The change is reversible: a single UPDATE flips it back, and the
-- workspace settings UI lets each user toggle it per-workspace.

-- 1. Backfill: flip the flag on each user's personal workspace.
update public.workspaces w
   set auto_assign_creator = true
 where w.auto_assign_creator = false
   and w.id = (
     select w2.id
       from public.workspaces w2
      where w2.owner_id = w.owner_id
        and (
          select count(*) from public.workspace_members wm
           where wm.workspace_id = w2.id
        ) = 1
      order by w2.created_at asc, w2.id asc
      limit 1
   );

-- 2. Future signups: redefine handle_new_user() so the bootstrap
--    workspace is born with auto_assign_creator = true. Body otherwise
--    identical to #0066 (handle derivation + workspace + owner member).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_workspace_id uuid;
  local_part text := split_part(new.email, '@', 1);
  base_handle text;
  candidate text;
  n int := 1;
begin
  base_handle := regexp_replace(lower(local_part), '[^a-z0-9_.\-]+', '', 'g');
  if base_handle = '' then
    base_handle := substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := base_handle || n::text;
  end loop;

  insert into public.profiles (id, display_name, handle)
  values (new.id, local_part, candidate);

  insert into public.workspaces (name, owner_id, auto_assign_creator)
  values (local_part || '''s Workspace', new.id, true)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;
