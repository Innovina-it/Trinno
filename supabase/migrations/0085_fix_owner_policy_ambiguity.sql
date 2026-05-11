-- 0081 introduced `enforce_card_owner_change_policy()` but declared
-- `workspace_id` and `board_visibility` as PL/pgSQL locals while the
-- embedded SELECTs reference `workspace_members.workspace_id` and
-- `boards.visibility` columns with the same identifiers — Postgres
-- raises `42702: column reference "workspace_id" is ambiguous` on
-- every owner_id update, even when the caller is a workspace owner.
-- Same class of bug as 0082 (sprint trigger) which 0083 already fixed
-- by underscore-prefixing the locals; the owner trigger never got
-- that treatment. Fix it the same way.
--
-- The trigger itself is already wired by 0081, so this migration only
-- replaces the function body — no new triggers.

create or replace function public.enforce_card_owner_change_policy()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  _board_visibility public.board_visibility;
  _workspace_id uuid;
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
    into _board_visibility, _workspace_id
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
      where wm.workspace_id = _workspace_id
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
      _board_visibility = 'workspace'
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = _workspace_id
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
        _board_visibility = 'workspace'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = _workspace_id
            and wm.user_id = new.owner_id
        )
      );

    if not target_can_own then
      raise exception 'Owner must be a board or workspace member.';
    end if;
  end if;

  return new;
end$$;
