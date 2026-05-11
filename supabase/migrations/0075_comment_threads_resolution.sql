-- Collaboration comments need two workflow signals:
-- - parent_comment_id for lightweight replies
-- - resolved_at/resolved_by for closing a comment thread

alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create index if not exists comments_parent_comment_id_idx
  on public.comments (parent_comment_id);

-- Authors can still edit their own comment body; board admins can resolve or
-- reopen any thread on the board. `comments_author_update` was too narrow for
-- admin moderation/workflow state, so replace it with the same author path plus
-- an admin path.
drop policy if exists comments_author_update on public.comments;
create policy comments_author_update on public.comments for update
  using (
    comments.author_id = auth.uid()
    or exists (
      select 1
      from public.board_members bm
      where bm.board_id = comments.board_id
        and bm.user_id = auth.uid()
        and bm.role = 'admin'
    )
  )
  with check (
    comments.author_id = auth.uid()
    or exists (
      select 1
      from public.board_members bm
      where bm.board_id = comments.board_id
        and bm.user_id = auth.uid()
        and bm.role = 'admin'
    )
  );
