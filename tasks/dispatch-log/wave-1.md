# Wave 1 — Dispatch 1a

**Date**: 2026-05-14
**Branch**: plan/01-foundation
**Orchestrator**: Claude (Opus 4.7)
**Status**: COMPLETE (with known carry-over for Wave 2)

## Dispatch 1a — Sub-board data model + Epic data migration

- **Subagent**: codex:codex-rescue
- **Agent id (successful run)**: `a5cb32318149be450`
- **Mode**: foreground
- **Duration**: ~596s
- **Result**: success

### Pre-flight: sandbox fix
Earlier attempts (`a8152dbbc4928856b`, `ab5cd5b695c80db85`) failed on `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Root cause: `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu/Jetson default). User applied `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` and persisted via `/etc/sysctl.d/60-bwrap.conf`. Bwrap now works.

### Files changed (writeset verification)
- `supabase/migrations/0099_board_subboard_columns.sql` (new) — adds `boards.parent_board_id` (FK ON DELETE SET NULL, indexed), `boards._migrated_from_epic_id` with `MIGRATED_FROM_EPIC_ID` comment, unique trace index
- `supabase/migrations/0100_migrate_epics_to_subboards.sql` (new) — creates audit tables, 1:1 lifts each `type='epic'` card to a child board, copies parent board members/lists, re-parents direct children, preserves deeper descendants; exposes `select public.rollback_epic_subboard_migration();` for `down`
- `lib/db/schema.ts` (modified) — adds `parentBoardId`, `migratedFromEpicId` to boards type
- `actions/cards.ts` (modified) — blocks runtime updates to `type='epic'`, updates epic-kanban comments to sub-board wording
- `lib/epic/group-children-by-status.ts` (deleted)
- `tests/unit/subboard-migration.test.ts` (new, relocated from `lib/subboard/__tests__/` by orchestrator post-dispatch to match project's `tests/**` discovery pattern; content unchanged)

All paths inside dispatch 1a's declared writeset. Pre-existing dirty files in `components/board/*` confirmed untouched (still 1b's WIP).

### Wave Gate
| Check | Result | Note |
|---|---|---|
| `npm run lint` | PASS | eslint clean |
| `npm run type-check` | FAIL (known) | `components/epic/epic-kanban-view.tsx:14` and `tests/unit/group-children-by-status.test.ts:2` still import the deleted `@/lib/epic/group-children-by-status`. **Both files are in dispatch 1b's writeset.** 1b MUST delete them. |
| `npm run db:reset` | FAIL (pre-existing) | Migration 0097 dies at `update public.notifications n ... from public.boards b left join public.profiles p on p.id = n.actor_user_id` with `invalid reference to FROM-clause entry for table "n"`. This is a **pre-existing repo bug**, not 1a's. Local supabase is now in a partial-applied state (stopped at 0096). Not blocking Wave 2 since dispatch writesets don't include 0097. Flag as separate issue. |
| 1a tests | PASS | `npx vitest run tests/unit/subboard-migration.test.ts` — 3/3 (golden, migration back-compat, failure/edge) |
| Writeset disjoint from Wave 2 | YES | 1b owns components/epic/* + components/board/* + docs + seed; 2 owns middleware + 0056/0057 + email-labels; 3a owns supabase/migrations/01XX_indexes_*.sql only; 3b owns lib/supabase/server.ts + browser.ts + .env.local.example + vercel.json. No overlap with 1a. |

### Phase 0 ambiguities surfaced by 1a
1. Repo has no separate down-migration files — convention is forward-only SQL. 1a matched this by exposing rollback as a callable PL/pgSQL function (`rollback_epic_subboard_migration()`) instead of a paired down file. Acceptable.
2. Direct `type='subtask'` children under an epic: DB requires subtasks to have a parent. Migration raises an error before touching data if detected, instead of guessing. Will surface only if such data exists.
3. No workspace feature-flag system found in repo (no `feature_flags` table, no `workspace_settings` JSONB). 1a did not invent one. `subboards_enabled` plumbing is left for 1b to design (or to escalate to product if 1b can't find an existing mechanism either).

### Carry-over for Wave 2
- **1b MUST delete or update**: `components/epic/epic-kanban-view.tsx`, `tests/unit/group-children-by-status.test.ts` (both reference deleted helper).
- **1b should design** the `subboards_enabled` flag mechanism (no existing system) or document why UI gating is deferred.
- **Independent pre-existing bug**: migration 0097 has a SQL FROM-clause error. Not in any 2026-05-14 dispatch's writeset. Track separately.
