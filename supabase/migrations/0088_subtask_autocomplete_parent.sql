-- When a card finishes (NULL → not-NULL on completed_at) and it has a
-- parent, check whether the parent's other children are also done. If
-- the last open child just flipped, mark the parent complete too. The
-- parent's own completion then cascades through 0086 (activity feed)
-- and 0087 (notification) the normal way — one notification per
-- parent, not one per child.
--
-- Single-level only: 0051 forbids epic-of-epic, so the parent of a
-- completing child cannot itself be a child. We never recurse, and we
-- never auto-uncomplete: un-checking one sub-task should not unwind
-- the parent's "we shipped this" state.
--
-- Two triggers because two paths get us here:
--   1. UPDATE: child's completed_at flips NULL → not-NULL.
--   2. INSERT: a new card arrives already complete (uncommon — bulk
--      import, "duplicate as done", etc.).
-- Both delegate to the same evaluator.

create or replace function public.cards_autocomplete_parent_eval(
  p_parent_id uuid
) returns void language plpgsql security definer set search_path = public
as $$
declare
  total_children int;
  open_children int;
  parent_completed_at timestamptz;
begin
  if p_parent_id is null then
    return;
  end if;

  -- Lock the parent row so two children completing concurrently don't
  -- both see "0 open" and both try to flip the parent. The UPDATE at
  -- the bottom is also idempotent (guarded by completed_at IS NULL),
  -- but the lock keeps the trigger paths predictable.
  select completed_at into parent_completed_at
    from public.cards
    where id = p_parent_id
    for update;

  -- Parent is gone (cascade) or already completed: nothing to do.
  if not found or parent_completed_at is not null then
    return;
  end if;

  select
    count(*) filter (where archived = false),
    count(*) filter (where archived = false and completed_at is null)
  into total_children, open_children
  from public.cards
  where parent_card_id = p_parent_id;

  -- No non-archived children means we have nothing to roll up from —
  -- treating that as "all done" would auto-complete every empty epic.
  if total_children = 0 then
    return;
  end if;

  if open_children = 0 then
    update public.cards
      set completed_at = now()
      where id = p_parent_id and completed_at is null;
  end if;
end$$;


create or replace function public.cards_autocomplete_parent_on_subtask()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.completed_at is not distinct from new.completed_at then
    return null;
  end if;
  if old.completed_at is null
     and new.completed_at is not null
     and new.parent_card_id is not null
  then
    perform public.cards_autocomplete_parent_eval(new.parent_card_id);
  end if;
  return null;
end$$;

drop trigger if exists cards_autocomplete_parent_aud on public.cards;
create trigger cards_autocomplete_parent_aud
  after update of completed_at on public.cards
  for each row execute function public.cards_autocomplete_parent_on_subtask();


-- INSERT path: a child that arrives already complete should still
-- nudge the parent. Rare but cheap to cover.
create or replace function public.cards_autocomplete_parent_on_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.completed_at is not null and new.parent_card_id is not null then
    perform public.cards_autocomplete_parent_eval(new.parent_card_id);
  end if;
  return null;
end$$;

drop trigger if exists cards_autocomplete_parent_aiu on public.cards;
create trigger cards_autocomplete_parent_aiu
  after insert on public.cards
  for each row execute function public.cards_autocomplete_parent_on_insert();
