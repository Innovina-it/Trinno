-- Workload-feature audit findings.  Two RLS gaps quietly drop rows
-- from the cross-workspace workload view:
--
-- 1) `card_members_select` (0011) only checks board_members.  Workspace
--    members of a `visibility = 'workspace'` board can SELECT cards but
--    not their card_members rows — so collaborator assignments
--    silently disappear from /workload for anyone who isn't an
--    explicit board_members row on a workspace-visible board.
--
-- 2) `profiles_self_select` (0003) requires sharing a workspace.  Two
--    users on a private cross-workspace board (one is owner of board
--    in W1, the other is board_member of the same board with no
--    workspace overlap) couldn't read each other's display_name.
--    The /workload lane label fell back to "Unknown" silently.
--
-- Both policies get an additional disjunct that mirrors the access
-- path the SELECT-on-cards already grants.

-- 1) card_members read.
drop policy if exists card_members_select on public.card_members;
create policy card_members_select on public.card_members for select
  using (
    -- Direct board membership.
    exists (
      select 1 from public.board_members bm
      where bm.board_id = card_members.board_id and bm.user_id = auth.uid()
    )
    -- Workspace-visible board path.
    or exists (
      select 1 from public.boards b
      where b.id = card_members.board_id
        and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

-- 2) profiles read — extend with the "I share a board with this person"
--    path so co-board-members can see each other's names even without
--    a shared workspace row.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select
  using (
    auth.uid() = profiles.id
    or exists (
      select 1 from public.workspace_members me
      where me.user_id = auth.uid()
        and public.is_workspace_member(me.workspace_id, profiles.id)
    )
    or exists (
      select 1 from public.board_members me
      join public.board_members them on them.board_id = me.board_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );
