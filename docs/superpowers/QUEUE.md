# Plan execution queue

Plans listed here are committed + ready for execution. Other Claude sessions can pick them up.

**Convention:** front of file = next to execute. Move to `## Done` after commit.

## Up next (in order)

- [~] **#16b-γ-Gantt-Master** — `docs/superpowers/plans/2026-04-30-plan-16b-gamma-gantt-master.md` — All remaining Gantt + integration improvements (28 changes, ~19 hrs subagent). Groups: A (CRUD parity, 9), B (workspace context on board pages + wrap-up, 5), C (Gantt UX polish, 10), D (cross-view bidirectional, 4). Subagent should commit per group.
  - Progress: A1-A9 ✅ (commits `6722542..22b323c`) · B1 ✅ (`ab1fdae`) · B2 ✅ (`d9274a3`) · B5 ✅ (this commit, concerns.md). Remaining: B3, B4, C1-C10, D1-D4.

- [ ] **#16b-γ-G drag-first Gantt** — `docs/superpowers/plans/2026-05-02-plan-16b-gamma-g-drag-first.md` — Drag-first roadmap manipulation (8 tasks, ~9.5 hr). G1 row reorder (manual `roadmap_order`), G2 cross-epic-lane reparent, G3 drag-paint new card, G4 priority enum gutter, G5 auto-scroll, G6 snap to dep ends, G7 chip-drag new card, G8 E2E. Decisions: priority=enum gutter (1A), order=decoupled int (2A), new card=both paint+chip.

- [ ] **#16b-γ-E forms** — NEEDS SCOPE. User said items "49-53" but master list not in repo. Write plan after user pastes item titles.

- [ ] **#16b-γ-F a11y + testing** — NEEDS SCOPE. User said items "16, 17, 58-60". Write plan after user pastes item titles. Likely covers ARIA roles, keyboard traps, contrast audit, axe-core, snapshot tests.

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
