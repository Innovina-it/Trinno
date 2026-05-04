-- Centralize the "can write to this board" check. A user is a writer if
-- they are an explicit board_member, OR the board is workspace-visible
-- and they are a workspace member. This mirrors the SELECT-side rule
-- already used everywhere and lets future policies stay one-liners.

create or replace function public.is_board_writer(_board_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.board_members
      where board_id = _board_id and user_id = _user_id
    )
    or exists (
      select 1 from public.boards b
      where b.id = _board_id and b.visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = b.workspace_id and wm.user_id = _user_id
        )
    );
$$;

-- Re-state lists/cards write policies through the helper. (Migration
-- 0048 introduced the same check inline; replacing those keeps things
-- consistent.)

drop policy if exists lists_member_insert on public.lists;
create policy lists_member_insert on public.lists for insert
  with check (public.is_board_writer(lists.board_id, auth.uid()));

drop policy if exists lists_member_write on public.lists;
create policy lists_member_write on public.lists for update
  using (public.is_board_writer(lists.board_id, auth.uid()))
  with check (public.is_board_writer(lists.board_id, auth.uid()));

drop policy if exists lists_member_delete on public.lists;
create policy lists_member_delete on public.lists for delete
  using (public.is_board_writer(lists.board_id, auth.uid()));

drop policy if exists cards_member_insert on public.cards;
create policy cards_member_insert on public.cards for insert
  with check (
    exists (
      select 1 from public.lists l
      where l.id = cards.list_id
        and public.is_board_writer(l.board_id, auth.uid())
    )
  );

drop policy if exists cards_member_write on public.cards;
create policy cards_member_write on public.cards for update
  using (public.is_board_writer(cards.board_id, auth.uid()))
  with check (public.is_board_writer(cards.board_id, auth.uid()));

drop policy if exists cards_member_delete on public.cards;
create policy cards_member_delete on public.cards for delete
  using (public.is_board_writer(cards.board_id, auth.uid()));

-- Card-content tables: open writes to workspace members of
-- workspace-visible boards, matching the parent card's reachability.

drop policy if exists labels_member_write on public.labels;
create policy labels_member_write on public.labels for all
  using (public.is_board_writer(labels.board_id, auth.uid()))
  with check (public.is_board_writer(labels.board_id, auth.uid()));

drop policy if exists card_labels_member_write on public.card_labels;
create policy card_labels_member_write on public.card_labels for all
  using (public.is_board_writer(card_labels.board_id, auth.uid()))
  with check (public.is_board_writer(card_labels.board_id, auth.uid()));

drop policy if exists card_members_member_write on public.card_members;
create policy card_members_member_write on public.card_members for all
  using (public.is_board_writer(card_members.board_id, auth.uid()))
  with check (public.is_board_writer(card_members.board_id, auth.uid()));

drop policy if exists checklists_member_write on public.checklists;
create policy checklists_member_write on public.checklists for all
  using (public.is_board_writer(checklists.board_id, auth.uid()))
  with check (public.is_board_writer(checklists.board_id, auth.uid()));

drop policy if exists checklist_items_member_write on public.checklist_items;
create policy checklist_items_member_write on public.checklist_items for all
  using (public.is_board_writer(checklist_items.board_id, auth.uid()))
  with check (public.is_board_writer(checklist_items.board_id, auth.uid()));

drop policy if exists comments_member_insert on public.comments;
create policy comments_member_insert on public.comments for insert
  with check (
    public.is_board_writer(comments.board_id, auth.uid())
    and comments.author_id = auth.uid()
  );

drop policy if exists attachments_member_insert on public.attachments;
create policy attachments_member_insert on public.attachments for insert
  with check (public.is_board_writer(attachments.board_id, auth.uid()));

drop policy if exists attachments_member_delete on public.attachments;
create policy attachments_member_delete on public.attachments for delete
  using (public.is_board_writer(attachments.board_id, auth.uid()));

drop policy if exists card_links_member_write on public.card_links;
create policy card_links_member_write on public.card_links for all
  using (public.is_board_writer(card_links.board_id, auth.uid()))
  with check (public.is_board_writer(card_links.board_id, auth.uid()));

drop policy if exists card_components_member_write on public.card_components;
create policy card_components_member_write on public.card_components for all
  using (public.is_board_writer(card_components.board_id, auth.uid()))
  with check (public.is_board_writer(card_components.board_id, auth.uid()));
