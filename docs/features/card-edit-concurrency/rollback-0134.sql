-- Down-migration for 0134_card_edit_rev.sql (Gate 3.5 dry-run script +
-- the real escape hatch if 0134 must be reverted on any env).
drop trigger if exists cards_bump_edit_rev on public.cards;
drop function if exists public.bump_card_edit_rev();
alter table public.cards drop column if exists edit_rev;
