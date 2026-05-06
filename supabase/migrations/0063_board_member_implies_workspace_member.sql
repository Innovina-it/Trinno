-- When user A invites user B to a board, B was previously inserted into
-- `board_members` only.  That left two visible bugs:
--
-- 1. The inbox notification rendered actor as "Someone" because
--    `profiles_shared_workspace_select` requires A and B to share a
--    workspace via `workspace_members` — board membership alone doesn't
--    count, so B couldn't read A's profile row.
--
-- 2. The workspace where the board lives never appeared in B's
--    workspace switcher (`workspaces_member_select` is the same shape),
--    so B had no way to navigate back to the shared board after closing
--    the inbox link.
--
-- Auto-insert a workspace_members row at the lowest 'member' role when
-- a board_member row appears, unless one already exists at any role.
-- Matches Trello / Jira's "board access implies workspace visibility"
-- model.  Runs as security definer to bypass the
-- `ws_members_admin_write` policy during the bootstrap.

create or replace function public.handle_board_member_implies_ws_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.boards where id = new.board_id;
  if ws is null then return new; end if;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, new.user_id, 'member')
    on conflict do nothing;
  return new;
end$$;

drop trigger if exists board_member_implies_ws_member_aiu on public.board_members;
create trigger board_member_implies_ws_member_aiu
  after insert on public.board_members
  for each row execute function public.handle_board_member_implies_ws_member();

-- Backfill: same rule for everyone already in `board_members` who is
-- not yet a workspace member.  Runs once at migration time.
insert into public.workspace_members (workspace_id, user_id, role)
select b.workspace_id, bm.user_id, 'member'
  from public.board_members bm
  join public.boards b on b.id = bm.board_id
  where not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = b.workspace_id
      and wm.user_id = bm.user_id
  )
on conflict do nothing;
