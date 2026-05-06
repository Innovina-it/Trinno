-- Observer role enforcement.  The board_role enum has had ('admin',
-- 'member', 'observer') since the start, but the write policies only
-- check membership, not role.  Net result: anyone given the observer
-- role could still INSERT/UPDATE/DELETE lists, cards, labels, etc —
-- defeating the role's purpose.
--
-- Tighten every write policy so role must be in ('admin', 'member')
-- for the board_member path.  Workspace-visible boards keep their
-- existing path (any workspace member writes), since giving someone
-- workspace 'member' role is the explicit gesture; if you want them
-- read-only on a specific board, set the board to private and add
-- them as observer.
--
-- Workspace dashboards / cards / etc not affected here.

-- Lists
drop policy if exists lists_member_insert on public.lists;
create policy lists_member_insert on public.lists for insert
  with check (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = lists.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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
      where bm.board_id = lists.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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
      where bm.board_id = lists.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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
      where bm.board_id = lists.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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

-- Cards (writes go via lists.board_id -> boards path, same shape)
drop policy if exists cards_member_insert on public.cards;
create policy cards_member_insert on public.cards for insert
  with check (
    exists (
      select 1 from public.lists l
      join public.board_members bm on bm.board_id = l.board_id
      where l.id = cards.list_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
    )
    or exists (
      select 1 from public.lists l
      join public.boards b on b.id = l.board_id
      where l.id = cards.list_id and b.visibility = 'workspace'
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
      where bm.board_id = cards.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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
      where bm.board_id = cards.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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
      where bm.board_id = cards.board_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'member')
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

-- Comments: comment authors retain edit/delete, but observer cannot
-- create new comments.
drop policy if exists comments_author_insert on public.comments;
create policy comments_author_insert on public.comments for insert
  with check (
    comments.author_id = auth.uid()
    and (
      exists (
        select 1 from public.board_members bm
        where bm.board_id = comments.board_id
          and bm.user_id = auth.uid()
          and bm.role in ('admin', 'member')
      )
      or exists (
        select 1 from public.boards b
        where b.id = comments.board_id and b.visibility = 'workspace'
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
          )
      )
    )
  );
