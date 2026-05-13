-- Assigning a card to a workspace-only user should promote that user to
-- board_member automatically. Mirrors 0063's board_member -> workspace_member
-- cascade so role expansion stays a one-way ratchet driven by usage.
--
-- Without this trigger, on a workspace-visible board the assignment would
-- succeed at the RLS layer (card_members write allows workspace members of
-- workspace-visible boards via is_board_writer) but the assignee never
-- appears in the board's members list and gets no inbox/avatar treatment.
-- Promoting them at assignment time keeps the two states in sync.
--
-- Runs as security definer so the assigning user, who may not be
-- board_admin/workspace_admin, can still trigger the implicit join.

create or replace function public.handle_card_member_implies_board_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.board_id is null then return new; end if;
  insert into public.board_members (board_id, user_id, role)
    values (new.board_id, new.user_id, 'member')
    on conflict do nothing;
  return new;
end$$;

drop trigger if exists card_member_implies_board_member_aiu on public.card_members;
create trigger card_member_implies_board_member_aiu
  after insert on public.card_members
  for each row execute function public.handle_card_member_implies_board_member();

-- Backfill: any existing card_members row whose user is not yet in
-- board_members. Catches cards that were assigned before this migration
-- through SQL or admin paths that bypassed the regular UI.
insert into public.board_members (board_id, user_id, role)
select cm.board_id, cm.user_id, 'member'
  from public.card_members cm
  where not exists (
    select 1 from public.board_members bm
    where bm.board_id = cm.board_id and bm.user_id = cm.user_id
  )
on conflict do nothing;
