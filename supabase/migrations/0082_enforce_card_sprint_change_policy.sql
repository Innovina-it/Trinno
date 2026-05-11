create or replace function public.enforce_card_sprint_change_policy()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  workspace_id uuid;
  sprint_workspace_id uuid;
begin
  if old.sprint_id is not distinct from new.sprint_id then
    return new;
  end if;

  if actor is null then
    raise exception 'Only authenticated users can change sprint assignment.';
  end if;

  select b.workspace_id
    into workspace_id
    from public.boards b
    where b.id = new.board_id;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_id
      and wm.user_id = actor
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Only workspace owners and admins can change sprint assignment.';
  end if;

  if new.sprint_id is not null then
    select s.workspace_id
      into sprint_workspace_id
      from public.sprints s
      where s.id = new.sprint_id;

    if sprint_workspace_id is null or sprint_workspace_id <> workspace_id then
      raise exception 'Sprint must belong to the card workspace.';
    end if;
  end if;

  return new;
end$$;

drop trigger if exists enforce_card_sprint_change_policy_bu on public.cards;
create trigger enforce_card_sprint_change_policy_bu
  before update of sprint_id on public.cards
  for each row execute function public.enforce_card_sprint_change_policy();
