-- Plan #16b-α (#11) — extend `handle_card_update_for_watchers` to fan out
-- notifications when roadmap start_date / target_date change. Existing
-- branches (archive, list move, due_date) are preserved by REPLACE.

create or replace function public.handle_card_update_for_watchers()
returns trigger language plpgsql security definer set search_path = public
as $$
declare w record;
begin
  if old.archived is distinct from new.archived then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id,
        case when new.archived then 'card.archived' else 'card.unarchived' end,
        new.id, new.board_id, auth.uid(),
        jsonb_build_object('title', new.title)
      );
    end loop;
  end if;
  if (old.list_id is distinct from new.list_id) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.moved', new.id, new.board_id, auth.uid(),
        jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id)
      );
    end loop;
  end if;
  if (old.due_date is distinct from new.due_date) or (old.due_complete is distinct from new.due_complete) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.due', new.id, new.board_id, auth.uid(),
        jsonb_build_object('due_date', new.due_date, 'due_complete', new.due_complete)
      );
    end loop;
  end if;
  if (old.start_date is distinct from new.start_date)
     or (old.target_date is distinct from new.target_date) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.dates', new.id, new.board_id, auth.uid(),
        jsonb_build_object('start_date', new.start_date, 'target_date', new.target_date)
      );
    end loop;
  end if;
  return new;
end$$;
