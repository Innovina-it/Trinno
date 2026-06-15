# Feature: milestone-as-card — workflow state

Convert milestones from their own `milestones` table into cards with `type="milestone"`.
ai-dev-control · Tier 3 · feature mode. Branch: `feat/milestone-as-card`.

## Goal / requirements (from user)
1. Gantt/roadmap graphical representation stays identical to today.
2. Milestone-cards must NOT appear on kanban boards.
3. Milestone must work with undo/redo.
4. Write — but do NOT execute — a migration script to move existing `milestones`
   rows into cards before dropping the table.

## Locked decisions
- **Option A** hosting: milestone-cards live in a per-board hidden "Milestones"
  list (`lists.hidden=true`). Card model untouched (no nullable listId/boardId).
- Orphan/workspace-level milestones host on the workspace's **oldest board**.
- **Option B** for board-less workspaces: require ≥1 board; show "Create a board
  before adding milestones." (e2e updated to create a board first.)
- Field mapping: `name→title`, `date→startDate=targetDate`, `color→coverColor`,
  `icon→new cards.icon` column. Milestone board-scope is collapsed (host board).
- IDs must be preserved in the U6 data migration (baselines reference milestoneId).

## Units & status
- [x] **U1 foundation** — committed `a56a19f`. `lists.hidden` (migration 0135),
  board-view excludes hidden lists, CardType += "milestone", realtime rowToList.
  Live-verified (hidden list disappears as a board column).
- [x] **U4 board-surface filters** — committed `7e8886a`. Excludes type=milestone
  from search/backlog/me-views/bulk; bulk "Move to list" filters hidden lists.
- [x] **U2 actions** — committed `551a388`. create/update/delete/list milestones
  operate on cards; ensureMilestoneList helper; migrations 0136 (cards.icon),
  0137 (widen cards_type_check to include 'milestone'). Live-verified via
  roadmap-milestone.spec.ts (PASS). Action signatures + MilestoneRow shape kept,
  so the dialog's undo/redo wiring is unchanged.
- [x] **U3 roadmap data-source** — committed `460b1ed` (with U5). Verified by
  construction: roadmap reads listMilestones() (card-backed) and MilestoneMarkers
  consumes the same storedMilestones array. Gantt diamond only renders when the
  roadmap grid renders (needs dated cards) — pre-existing, unrelated to this work.
- [x] **U5 repoint readers** — committed `460b1ed`. `lib/pma/inputs.ts` live
  milestones now read from cards; it was the ONLY remaining live table reader
  (baseline compare runs off card-backed storedMilestones; baseline snapshots
  keep their own rows). Undo/redo works by construction (U2 kept action
  signatures; dialog undo wiring unchanged).
- [x] **U6 migration script (WRITE ONLY)** — committed. File:
  `docs/features/milestone-as-card/migrate-milestones-to-cards.sql` (kept OUT of
  supabase/migrations so it never auto-runs; DROP left commented as a guard).
  Logic dry-run-validated on dev in a rolled-back transaction: 1 moved, id
  preserved, lands in hidden list, correct field mapping, nothing persisted.

## ALL UNITS DONE — ready for manual testing. U6 script intentionally NOT run.

## Key gotchas learned
- `cards_type_check` CHECK constraint (migration 0106) limited type to
  story/task/subtask/bug — recon wrongly said "no enum constraint". Widened in 0137.
- Adding a column to `cards`/`lists` in Drizzle makes EVERY card/list select
  include it → must apply the additive migration to dev or queries 500. (This is
  what caused the user's "Failed query ... icon" error; fixed by applying 0136.)
- Dev = local Supabase (Studio :54323, DB postgresql://postgres:postgres@127.0.0.1:54322/postgres).
  Apply migrations with `supabase migration up --local`. NEVER `db reset`.
- Live e2e: minimal seed creates NO board; `/b/<id>` direct-nav redirects to
  /roadmap. Reach the kanban via nav-boards → New board. Date field: fill
  `date-picker-display` with dd/mm/yyyy, then click Name to dismiss the calendar.

## Out of commits (another process is editing these — do not include)
- components/workspace/invite-member-form.tsx
- actions/profile-search.ts

## Remaining gates
U3 verify (Gate 4) → U5 (Gate 3/4) → U6 (Gate 3/4, artifact-only) → Harvest (Gate 5).
