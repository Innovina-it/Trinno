-- Track assignee (card_members) changes in the card audit feed. 0091/
-- 0113 only watch the `cards` table, so adding/removing an assignee left
-- no trace in History. This writes into the same card_field_history
-- table with two new field values: 'assignee_add' / 'assignee_remove'.
-- The assigned/removed user id goes in new_value / old_value (text);
-- the read query resolves it to a display name. actor_id = auth.uid().
--
-- security definer so the trigger may write the audit row regardless of
-- the card_field_history RLS (which has SELECT-only policies). The
-- insert is wrapped so an audit failure never rolls back the membership
-- change itself.
create or replace function public.card_members_record_history()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
        values (new.card_id, auth.uid(), 'assignee_add', null, new.user_id::text);
    elsif tg_op = 'DELETE' then
      insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
        values (old.card_id, auth.uid(), 'assignee_remove', old.user_id::text, null);
    end if;
  exception when others then
    -- never let the audit write fail a membership change; surface as a
    -- log warning so a swallowed failure is still observable in pg logs.
    raise warning 'card_members_record_history failed (op %): %', tg_op, sqlerrm;
  end;
  return null;
end$$;

drop trigger if exists card_members_record_history_ai on public.card_members;
create trigger card_members_record_history_ai
  after insert on public.card_members
  for each row execute function public.card_members_record_history();

drop trigger if exists card_members_record_history_ad on public.card_members;
create trigger card_members_record_history_ad
  after delete on public.card_members
  for each row execute function public.card_members_record_history();
