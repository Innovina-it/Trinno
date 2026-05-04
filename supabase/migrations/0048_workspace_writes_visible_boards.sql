-- Workspace members of a workspace-visible board can already SELECT
-- lists/cards, but the original write policies only let board_members
-- INSERT/UPDATE/DELETE. That makes a freshly created workspace board
-- read-only to everyone except the creator (who is auto-added as
-- admin) — even when visibility = 'workspace' explicitly opens it.
--
-- Mirror the SELECT visibility rule on every list/card write policy.
-- The board's own write policy still gates structural changes (rename,
-- archive, delete) to board_admin or workspace_admin; this only opens
-- the contents of a workspace-visible board to workspace members.

drop policy if exists lists_member_insert on public.lists;
create policy lists_member_insert on public.lists for insert
  with check (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = lists.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = lists.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

drop policy if exists lists_member_write on public.lists;
create policy lists_member_write on public.lists for update
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = lists.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = lists.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  )
  with check (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = lists.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = lists.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

drop policy if exists lists_member_delete on public.lists;
create policy lists_member_delete on public.lists for delete
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = lists.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = lists.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

drop policy if exists cards_member_insert on public.cards;
create policy cards_member_insert on public.cards for insert
  with check (
    exists (
      select 1 from public.lists l
      join public.board_members bm on bm.board_id = l.board_id
      where l.id = cards.list_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.lists l
      join public.boards b on b.id = l.board_id
      where l.id = cards.list_id
        and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

drop policy if exists cards_member_write on public.cards;
create policy cards_member_write on public.cards for update
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = cards.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = cards.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  )
  with check (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = cards.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = cards.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );

drop policy if exists cards_member_delete on public.cards;
create policy cards_member_delete on public.cards for delete
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = cards.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      where b.id = cards.board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
        )
    )
  );
