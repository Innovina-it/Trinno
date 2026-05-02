-- Plan #16b-γ-G G1 follow-up — extend `activity_cards_aud` to log
-- roadmap_order changes. The G1 commit deliberately skipped this so the
-- 2 hr task could land; this migration plus the unchanged action close
-- the gap. A change to `roadmap_order` (any direction) emits a single
-- `card.roadmap_order` row carrying the new rank.
--
-- We REPLACE the function to keep all existing branches.

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
    if old.start_date is not distinct from new.start_date then
      perform public.log_activity(new.board_id, new.id, 'card.dates',
        jsonb_build_object('start_date', new.start_date, 'target_date', new.target_date));
    end if;
  end if;
  if old.roadmap_order is distinct from new.roadmap_order then
    perform public.log_activity(new.board_id, new.id, 'card.roadmap_order',
      jsonb_build_object('roadmap_order', new.roadmap_order));
  end if;
  return null;
end$$;
