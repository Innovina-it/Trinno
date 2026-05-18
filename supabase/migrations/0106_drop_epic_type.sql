-- 0106 - drop the deprecated 'epic' card type and its support objects.
--
-- Preconditions:
--   * 0099 added boards.parent_board_id (sub-boards).
--   * 0100 cloned every type='epic' card into a sibling sub-board and moved
--     its descendants into that sub-board. The original epic card stayed
--     on the parent board.
--   * 0105 added boards.parent_card_id (1:1 card->subboard anchor).
--
-- This migration finalises the deprecation:
--   1. Backfill boards.parent_card_id from boards._migrated_from_epic_id
--      so every sub-board produced by 0100 is now anchored to the surviving
--      epic-typed card (if that card still exists and the anchor slot is
--      free).
--   2. Demote any remaining type='epic' card to 'story' so the enum value
--      can be dropped without violating the check constraint.
--   3. Drop the epic-only triggers and functions installed by 0051 / 0061.
--   4. Replace the cards.type check constraint with one that no longer
--      allows 'epic'.
--   5. Drop the audit/scratch tables created by 0100 and the
--      rollback_epic_subboard_migration helper (audit lives in git
--      history; the runtime no longer needs them).
--   6. Drop boards._migrated_from_epic_id (no remaining readers).

-- 1. Backfill parent_card_id on sub-boards produced by 0100. ----------------
update public.boards b
set parent_card_id = b._migrated_from_epic_id
where b._migrated_from_epic_id is not null
  and b.parent_card_id is null
  and exists (select 1 from public.cards c where c.id = b._migrated_from_epic_id);

-- 2. Demote stragglers. -----------------------------------------------------
update public.cards
set type = 'story'
where type = 'epic';

-- 3. Drop triggers + functions tied to the epic type. ----------------------
drop trigger if exists cards_validate_epic_parent_biu on public.cards;
drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
drop trigger if exists cards_reject_epic_with_epic_children_bu on public.cards;
drop trigger if exists cards_rollup_epic_dates_aiu on public.cards;
drop trigger if exists cards_rollup_epic_dates_ad on public.cards;

drop function if exists public.cards_validate_epic_parent();
drop function if exists public.cards_co_locate_with_epic_parent();
drop function if exists public.cards_reject_epic_with_epic_children();
drop function if exists public.cards_rollup_epic_dates();

-- 4. Replace the cards.type check constraint. ------------------------------
alter table public.cards drop constraint if exists cards_type_check;
alter table public.cards
  add constraint cards_type_check
  check (type in ('story', 'task', 'subtask', 'bug'));

-- 5. Drop migration audit tables + rollback helper (no longer referenced). -
drop function if exists public.rollback_epic_subboard_migration();
drop table if exists public.epic_subboard_migration_cards;
drop table if exists public.epic_subboard_migration_lists;
drop table if exists public.epic_subboard_migrations;

-- 6. Drop the now-orphan column. -------------------------------------------
alter table public.boards drop column if exists _migrated_from_epic_id;
