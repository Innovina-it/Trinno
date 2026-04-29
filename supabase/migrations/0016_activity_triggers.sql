create or replace function public.log_activity(
  p_board_id uuid, p_card_id uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  -- Skip logging if the parent board no longer exists. This handles cascade
  -- deletes (board → board_members/cards/comments/...) where AFTER DELETE
  -- triggers would otherwise violate the activity_board_id_fkey constraint.
  if not exists (select 1 from public.boards where id = p_board_id) then
    return;
  end if;
  insert into public.activity (board_id, card_id, actor_id, type, payload)
  values (p_board_id, p_card_id, auth.uid(), p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- LISTS
create or replace function public.activity_lists_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, null, 'list.create',
    jsonb_build_object('id', new.id, 'title', new.title));
  return null;
end$$;
create trigger activity_lists_aiu after insert on public.lists
  for each row execute function public.activity_lists_aiu();

create or replace function public.activity_lists_aud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.title is distinct from new.title then
    perform public.log_activity(new.board_id, null, 'list.rename',
      jsonb_build_object('id', new.id, 'from', old.title, 'to', new.title));
  end if;
  if old.archived is distinct from new.archived then
    perform public.log_activity(new.board_id, null,
      case when new.archived then 'list.archive' else 'list.unarchive' end,
      jsonb_build_object('id', new.id, 'title', new.title));
  end if;
  return null;
end$$;
create trigger activity_lists_aud after update on public.lists
  for each row execute function public.activity_lists_aud();

-- CARDS
create or replace function public.activity_cards_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, new.id, 'card.create',
    jsonb_build_object('title', new.title, 'list_id', new.list_id));
  return null;
end$$;
create trigger activity_cards_aiu after insert on public.cards
  for each row execute function public.activity_cards_aiu();

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
  return null;
end$$;
create trigger activity_cards_aud after update on public.cards
  for each row execute function public.activity_cards_aud();

-- COMMENTS
create or replace function public.activity_comments_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, new.card_id, 'comment.create',
    jsonb_build_object('id', new.id));
  return null;
end$$;
create trigger activity_comments_aiu after insert on public.comments
  for each row execute function public.activity_comments_aiu();

create or replace function public.activity_comments_aud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.body is distinct from new.body then
    perform public.log_activity(new.board_id, new.card_id, 'comment.edit',
      jsonb_build_object('id', new.id));
  end if;
  return null;
end$$;
create trigger activity_comments_aud after update on public.comments
  for each row execute function public.activity_comments_aud();

create or replace function public.activity_comments_ad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(old.board_id, old.card_id, 'comment.delete',
    jsonb_build_object('id', old.id));
  return null;
end$$;
create trigger activity_comments_ad after delete on public.comments
  for each row execute function public.activity_comments_ad();

-- CARD_LABELS
create or replace function public.activity_card_labels_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, new.card_id, 'card.label.add',
    jsonb_build_object('label_id', new.label_id));
  return null;
end$$;
create trigger activity_card_labels_aiu after insert on public.card_labels
  for each row execute function public.activity_card_labels_aiu();

create or replace function public.activity_card_labels_ad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(old.board_id, old.card_id, 'card.label.remove',
    jsonb_build_object('label_id', old.label_id));
  return null;
end$$;
create trigger activity_card_labels_ad after delete on public.card_labels
  for each row execute function public.activity_card_labels_ad();

-- CARD_MEMBERS
create or replace function public.activity_card_members_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, new.card_id, 'card.member.assign',
    jsonb_build_object('user_id', new.user_id));
  return null;
end$$;
create trigger activity_card_members_aiu after insert on public.card_members
  for each row execute function public.activity_card_members_aiu();

create or replace function public.activity_card_members_ad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(old.board_id, old.card_id, 'card.member.unassign',
    jsonb_build_object('user_id', old.user_id));
  return null;
end$$;
create trigger activity_card_members_ad after delete on public.card_members
  for each row execute function public.activity_card_members_ad();

-- BOARD_MEMBERS
create or replace function public.activity_board_members_aiu()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, null, 'board.member.add',
    jsonb_build_object('user_id', new.user_id, 'role', new.role));
  return null;
end$$;
create trigger activity_board_members_aiu after insert on public.board_members
  for each row execute function public.activity_board_members_aiu();

create or replace function public.activity_board_members_ad()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(old.board_id, null, 'board.member.remove',
    jsonb_build_object('user_id', old.user_id));
  return null;
end$$;
create trigger activity_board_members_ad after delete on public.board_members
  for each row execute function public.activity_board_members_ad();
