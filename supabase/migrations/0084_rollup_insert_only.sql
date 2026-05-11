-- Disable epic date auto-extend on UPDATE. Migration 0061 fired the
-- rollup trigger on AFTER INSERT OR UPDATE OF start_date / target_date
-- / parent_card_id / archived, which meant that *moving* a child past
-- its parent's bounds would silently stretch the parent's bar — users
-- read this as "dragging card A also lengthens card B" since the
-- parent's bar lives in the same lane.
--
-- New policy: rollup runs only on INSERT (so a freshly-linked child
-- still inherits parent span) and DELETE (recompute remaining children
-- so a removal can re-tighten the parent — though the trigger never
-- shrinks). Manual UPDATE on a child does not touch the parent.

drop trigger if exists cards_rollup_epic_dates_aiu on public.cards;

create trigger cards_rollup_epic_dates_ai
  after insert on public.cards
  for each row execute function public.cards_rollup_epic_dates();
