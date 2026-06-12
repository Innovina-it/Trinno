-- card-edit-concurrency U1 — optimistic-concurrency counter for card
-- TEXT edits. `edit_rev` bumps ONLY when title or description actually
-- change (BEFORE UPDATE OF + IS DISTINCT FROM guard), so moves, drags,
-- completion, priority etc. never invalidate a stale editor's rev and
-- never produce false conflicts. Named edit_rev (not "version") to stay
-- clear of the release-versions domain (0032_versions.sql).

alter table public.cards
  add column edit_rev integer not null default 0;

create or replace function public.bump_card_edit_rev()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.title is distinct from old.title
     or new.description is distinct from old.description then
    new.edit_rev := old.edit_rev + 1;
  end if;
  return new;
end;
$$;

create trigger cards_bump_edit_rev
  before update of title, description on public.cards
  for each row execute function public.bump_card_edit_rev();
