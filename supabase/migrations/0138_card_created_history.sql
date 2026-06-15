-- Log a card's creation in the audit feed. Companion to 0091/0113,
-- which only fire AFTER UPDATE and therefore never recorded a card's
-- birth (History stayed empty until the first edit). This adds a
-- dedicated AFTER INSERT trigger that writes a single `created` row.
-- Modelled on 0089's AFTER INSERT sprint trigger. Not a re-CREATE of
-- cards_record_field_history() — that function is left untouched.
--
-- No backfill: existing cards have no reliable creator (cards has no
-- created_by column), so only cards created from now on get the event.
--
-- The insert is wrapped so a logging failure can never roll back the
-- card creation itself — card creation is the priority, the audit row
-- is best-effort.
create or replace function public.cards_record_create_history()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'created', null, null);
  exception when others then
    -- never let the audit write fail a card insert; surface as a log
    -- warning so a swallowed failure is still observable in pg logs.
    raise warning 'cards_record_create_history failed for card %: %', new.id, sqlerrm;
  end;
  return null;
end$$;

drop trigger if exists cards_record_create_history_ai on public.cards;
create trigger cards_record_create_history_ai
  after insert on public.cards
  for each row execute function public.cards_record_create_history();
