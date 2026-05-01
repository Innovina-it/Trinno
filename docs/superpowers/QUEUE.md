# Plan execution queue

Plans listed here are committed + ready for execution. Other Claude sessions can pick them up.

**Convention:** front of file = next to execute. Move to `## Done` after commit.

## Up next (in order)

- [ ] **#16b-γ-Gantt-CRUD** — `docs/superpowers/plans/2026-04-30-plan-16b-gamma-gantt-crud.md` — Gantt usability + CRUD + filter parity (~6 hrs subagent). Plan committed `1b6d229`. Depends on γ-B + γ-D merged. **9 tasks**: click-to-modal, hover overflow menu, search input, quick-add dialog, bar tooltip, filter parity, keyboard shortcuts, epic-row link, verify.

- [ ] **#16b-γ-E forms** — NEEDS SCOPE. User said items "49-53" but master list not in repo. Write plan after user pastes item titles.

- [ ] **#16b-γ-F a11y + testing** — NEEDS SCOPE. User said items "16, 17, 58-60". Write plan after user pastes item titles. Likely covers ARIA roles, keyboard traps, contrast audit, axe-core, snapshot tests.

- [ ] **#16b-γ-Wrap-up** — `docs/superpowers/plans/` (not yet written) — leftover items from my earlier γ table:
  - γ-1: mount `WorkspaceStoreProvider` on board pages
  - γ-2: resolve sprint NAME on Kanban tile (replace "IN SPRINT")
  - γ-5: status badge on Kanban tile
  - γ-8: `card_links` workspace realtime extension
  - γ-10: concerns doc in `docs/superpowers/concerns.md`
  ~3 hrs subagent. Plan to write before dispatch.

## Done

- #1-#7 Trello core
- #8 hierarchy / #9 links / #10 components+versions / #11 sprints / #12 story-points+velocity / #13 roadmap+gantt / #14 wip+swimlanes+filters / #16 dashboards+gadgets / #22 time+SLA / #23 mentions+watchers+inbox
- #16b-α quick wins (10 changes — activity audit, schedule chip, focus link, etc.)
- #16b-β workspace store + realtime sync
- #16b-γ-A core gantt (status mapping, critical path, cascade, E2E)
- #16b-γ-B onboarding (templates + seed + first-run tour)
- #16b-γ-C usability (priority, cover, virtualize, favorites, recents, error pane, empty states)
- #16b-γ-D power+bulk+nav (palette, quick-add, [], multi-select, undo, cross-board, ws-search)

## Concurrency rules

If two Claudes pick from queue at same time:
1. Each takes the FIRST `[ ]` item.
2. Mark as `[ ]` → `[~]` (in-progress) the moment dispatch starts.
3. Drop `[~]` and replace with `[x]` after commit.
4. If `[~]` already present when you arrive, take the NEXT `[ ]`.
5. Each Claude works in own worktree + own port range to avoid file/db conflicts.

## Worktree allocation

| Claude | Worktree | Branch | Supabase ports | Dev port |
|---|---|---|---|---|
| A (default) | `/home/innovina/Documents/trello-foundation` | `plan/01-foundation` | 54321-54324 | 3000 |
| B (parallel) | `/home/innovina/Documents/tf-secondary` | `plan/secondary` | 54331-54334 | 3001 |

Setup B:
```bash
cd /home/innovina/Documents/trello-foundation
git worktree add -b plan/secondary ../tf-secondary
cd ../tf-secondary
# Edit supabase/config.toml: shift all ports +10
supabase start
PORT=3001 npm run dev
```
