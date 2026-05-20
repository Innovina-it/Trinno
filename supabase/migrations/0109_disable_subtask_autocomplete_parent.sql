-- Drop the DB-side subtask → parent autocomplete cascade introduced in
-- 0088. Parent status sync is now user-driven: the client opens a
-- confirmation modal when the last open child is completed (or when a
-- child is re-opened while the parent is in a done state) and calls a
-- server action that updates the parent only on explicit confirm.
--
-- Removing the trigger here keeps the activity feed (0086) honest: a
-- card.complete row on the parent now corresponds to an actor decision,
-- not to a hidden cascade.

drop trigger if exists cards_autocomplete_parent_aud on public.cards;
drop trigger if exists cards_autocomplete_parent_aiu on public.cards;

drop function if exists public.cards_autocomplete_parent_on_subtask();
drop function if exists public.cards_autocomplete_parent_on_insert();
drop function if exists public.cards_autocomplete_parent_eval(uuid);
