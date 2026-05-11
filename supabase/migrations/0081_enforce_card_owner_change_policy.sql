create or replace function public.enforce_card_owner_change_policy()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  board_visibility public.board_visibility;
  workspace_id uuid;
  is_admin boolean;
  is_writable_member boolean;
  target_can_own boolean;
begin
  if old.owner_id is not distinct from new.owner_id then
    return new;
  end if;

  if actor is null then
    raise exception 'Only authenticated users can change owner.';
  end if;

  select b.visibility, b.workspace_id
    into board_visibility, workspace_id
    from public.boards b
    where b.id = new.board_id;

  is_admin := exists (
      select 1 from public.board_members bm
      where bm.board_id = new.board_id
        and bm.user_id = actor
        and bm.role = 'admin'
    )
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_id
        and wm.user_id = actor
        and wm.role in ('owner', 'admin')
    );

  is_writable_member := exists (
      select 1 from public.board_members bm
      where bm.board_id = new.board_id
        and bm.user_id = actor
        and bm.role in ('admin', 'member')
    )
    or (
      board_visibility = 'workspace'
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = workspace_id
          and wm.user_id = actor
      )
    );

  if not (
    is_admin
    or old.owner_id = actor
    or (old.owner_id is null and new.owner_id = actor and is_writable_member)
  ) then
    raise exception 'Only admins, the current owner, or a member claiming an unowned card can change owner.';
  end if;

  if new.owner_id is not null then
    target_can_own := exists (
        select 1 from public.board_members bm
        where bm.board_id = new.board_id
          and bm.user_id = new.owner_id
      )
      or (
        board_visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = workspace_id
            and wm.user_id = new.owner_id
        )
      );

    if not target_can_own then
      raise exception 'Owner must be a board or workspace member.';
    end if;
  end if;

  return new;
end$$;

drop trigger if exists enforce_card_owner_change_policy_bu on public.cards;
create trigger enforce_card_owner_change_policy_bu
  before update of owner_id on public.cards
  for each row execute function public.enforce_card_owner_change_policy();
