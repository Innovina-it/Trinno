-- =============================================================================
-- U6 — milestone-as-card DATA MIGRATION  (MANUAL, WRITE-ONLY — DO NOT AUTO-RUN)
-- =============================================================================
-- This file is intentionally OUTSIDE supabase/migrations/ so it never runs via
-- `supabase migration up`. Dropping the milestones table is irreversible — run
-- this deliberately, per environment, ONLY AFTER U1–U5 are deployed there
-- (lists.hidden, cards.icon, cards_type_check widened, and all readers repointed
-- to cards). Take a database backup first.
--
-- What it does, in order:
--   1. Copies every `milestones` row into a card with type='milestone',
--      PRESERVING the original id (so roadmap_baseline_milestones.milestone_id
--      references keep resolving), mapping:
--        name        -> cards.title
--        date        -> cards.start_date AND cards.target_date (point render)
--        description -> cards.description
--        color       -> cards.cover_color
--        icon        -> cards.icon
--        created_by  -> cards.owner_id
--      Host board = milestone.board_id, else the workspace's OLDEST board.
--      Each host board gets a find-or-create hidden "Milestones" list.
--   2. Orphans whose workspace has NO board are SKIPPED and reported (RAISE
--      NOTICE) — they cannot be hosted under the "every card lives on a board"
--      rule (Option B). Decide per environment whether to give those workspaces
--      a board and re-run, or leave the milestones behind before the drop.
--   3. DROPS the milestones table (final, separate step — verify first).
--
-- The migration is re-runnable for step 1 (ON CONFLICT (id) DO NOTHING); the
-- DROP at the end is the point of no return.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — copy milestones into cards (idempotent). Run, then verify STEP 2.
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  m           RECORD;
  host_board  uuid;
  ms_list     uuid;
  next_pos    text;
  moved       int := 0;
  skipped     int := 0;
BEGIN
  FOR m IN SELECT * FROM milestones LOOP
    -- Resolve the host board (explicit board, else oldest board in workspace).
    host_board := m.board_id;
    IF host_board IS NULL THEN
      SELECT id INTO host_board
      FROM boards
      WHERE workspace_id = m.workspace_id
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    -- Orphan with no board anywhere in the workspace: skip + report.
    IF host_board IS NULL THEN
      RAISE NOTICE 'SKIP milestone % (%) — workspace % has no board',
        m.id, m.name, m.workspace_id;
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    -- Find-or-create the hidden "Milestones" list on the host board.
    SELECT id INTO ms_list
    FROM lists
    WHERE board_id = host_board AND hidden = true AND title = 'Milestones'
    LIMIT 1;

    IF ms_list IS NULL THEN
      ms_list := gen_random_uuid();
      INSERT INTO lists (id, board_id, title, position, hidden)
      VALUES (
        ms_list,
        host_board,
        'Milestones',
        COALESCE((SELECT max(position) FROM lists WHERE board_id = host_board), '') || 'm',
        true
      );
    END IF;

    -- Append position within the milestones list.
    next_pos := COALESCE((SELECT max(position) FROM cards WHERE list_id = ms_list), '') || 'm';

    -- Insert the milestone card, preserving the original milestone id.
    -- board_id is set explicitly to the host board (matches the cards_set_board_id
    -- trigger's value, so they agree).
    INSERT INTO cards (
      id, list_id, board_id, title, type, position,
      start_date, target_date, description, cover_color, icon, owner_id, created_at
    )
    VALUES (
      m.id, ms_list, host_board, m.name, 'milestone', next_pos,
      m.date, m.date, m.description, COALESCE(m.color, '#6366f1'), m.icon,
      m.created_by, m.created_at
    )
    ON CONFLICT (id) DO NOTHING;

    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'milestone-as-card migration: % moved, % skipped (no board)', moved, skipped;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY before STEP 2. Expect: every non-orphan milestone now has a card with
-- the same id, type='milestone', in a hidden list. This should return 0 rows.
-- ---------------------------------------------------------------------------
-- SELECT m.id, m.name, m.workspace_id
-- FROM milestones m
-- WHERE EXISTS (SELECT 1 FROM boards b WHERE b.workspace_id = m.workspace_id)
--   AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = m.id AND c.type = 'milestone');

-- ---------------------------------------------------------------------------
-- STEP 2 — point of no return. Run ONLY after the verify query returns 0 rows
-- and you have accepted any skipped orphans. No FK references milestones, so the
-- drop is clean.
-- ---------------------------------------------------------------------------
-- DROP TABLE milestones;
