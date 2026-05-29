-- Track list moves in the card audit log. Companion to 0091: the
-- field-history trigger covered every high-signal scalar EXCEPT the
-- card's list (column). Moving a card between columns (e.g. In Progress
-- → Closed) left no trace in the History feed. `moveCardImpl` persists
-- the move as `update cards set list_id = …`, so the existing AFTER
-- UPDATE trigger already fires — it just wasn't recording the field.
--
-- This migration re-creates `cards_record_field_history()` (CREATE OR
-- REPLACE replaces the whole body) with all of 0091's blocks plus a new
-- `list_id` block. old/new values are stored as raw list UUIDs (text),
-- same as the other fk fields; the read query (card-history.ts) resolves
-- them to list titles for display. INSERT is not tracked (trigger is
-- UPDATE-only), so a card's initial list at creation is not logged —
-- only subsequent moves, which is the intent.

create or replace function public.cards_record_field_history()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  _actor uuid := auth.uid();
begin
  if old.title is distinct from new.title then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'title', old.title, new.title);
  end if;

  if old.priority is distinct from new.priority then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'priority', old.priority::text, new.priority::text);
  end if;

  if old.owner_id is distinct from new.owner_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'owner_id', old.owner_id::text, new.owner_id::text);
  end if;

  if old.start_date is distinct from new.start_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'start_date', old.start_date::text, new.start_date::text);
  end if;

  if old.target_date is distinct from new.target_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'target_date', old.target_date::text, new.target_date::text);
  end if;

  if old.due_date is distinct from new.due_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'due_date', old.due_date::text, new.due_date::text);
  end if;

  if old.completed_at is distinct from new.completed_at then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'completed_at', old.completed_at::text, new.completed_at::text);
  end if;

  if old.sprint_id is distinct from new.sprint_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'sprint_id', old.sprint_id::text, new.sprint_id::text);
  end if;

  if old.list_id is distinct from new.list_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'list_id', old.list_id::text, new.list_id::text);
  end if;

  if old.parent_card_id is distinct from new.parent_card_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'parent_card_id', old.parent_card_id::text, new.parent_card_id::text);
  end if;

  if old.type is distinct from new.type then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'type', old.type::text, new.type::text);
  end if;

  if old.story_points is distinct from new.story_points then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'story_points', old.story_points::text, new.story_points::text);
  end if;

  if old.estimate_min is distinct from new.estimate_min then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'estimate_min', old.estimate_min::text, new.estimate_min::text);
  end if;

  return null;
end$$;

-- Trigger binding is unchanged (still the AFTER UPDATE row trigger from
-- 0091); re-asserting it here is harmless and keeps the migration
-- self-contained if 0091 was never applied.
drop trigger if exists cards_record_field_history_au on public.cards;
create trigger cards_record_field_history_au
  after update on public.cards
  for each row execute function public.cards_record_field_history();
