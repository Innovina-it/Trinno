-- Plan #16b-α (#1) — extend `activity_cards_aud` to log roadmap date changes.
-- We REPLACE the function to keep all existing branches (title / description /
-- move / archive / due) and add new branches for `start_date` and `target_date`.
-- A single change to either field emits a `card.dates` activity row carrying
-- both new values, since the UI presents them as a paired interval.

create or replace function public.activity_cards_aud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.title is distinct from new.title then
    perform public.log_activity(new.board_id, new.id, 'card.rename',
      jsonb_build_object('from', old.title, 'to', new.title));
  end if;
  if old.description is distinct from new.description then
    perform public.log_activity(new.board_id, new.id, 'card.description',
      jsonb_build_object('title', new.title));
  end if;
  if (old.list_id is distinct from new.list_id) or (old.position is distinct from new.position) then
    perform public.log_activity(new.board_id, new.id, 'card.move',
      jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id));
  end if;
  if old.archived is distinct from new.archived then
    perform public.log_activity(new.board_id, new.id,
      case when new.archived then 'card.archive' else 'card.unarchive' end,
      jsonb_build_object('title', new.title));
  end if;
  if (old.due_date is distinct from new.due_date) or (old.due_complete is distinct from new.due_complete) then
    perform public.log_activity(new.board_id, new.id, 'card.due',
      jsonb_build_object('due_date', new.due_date, 'due_complete', new.due_complete));
  end if;
  if old.start_date is distinct from new.start_date then
    perform public.log_activity(new.board_id, new.id, 'card.dates',
      jsonb_build_object('start_date', new.start_date, 'target_date', new.target_date));
  end if;
  if old.target_date is distinct from new.target_date then
    -- guard against double-emit when both columns change in the same UPDATE
    if old.start_date is not distinct from new.start_date then
      perform public.log_activity(new.board_id, new.id, 'card.dates',
        jsonb_build_object('start_date', new.start_date, 'target_date', new.target_date));
    end if;
  end if;
  return null;
end$$;
