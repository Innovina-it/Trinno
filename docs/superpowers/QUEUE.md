# Plan execution queue

Plans listed here are committed + ready for execution. Other Claude sessions can pick them up.

**Convention:** front of file = next to execute. Move to `## Done` after commit.

## Up next (in order)

- [ ] **#16b-γ-E forms** — ~6 hrs subagent. Items 49-53:
  - #49 markdown desc/comments
  - #50 mention autocomplete
  - #51 paste image
  - #52 file drop
  - #53 date picker

- [ ] **#16b-γ-F a11y + testing** — ~10 hrs subagent. Items 16, 17, 58-60:
  - #16 SR gantt (screen-reader Gantt narration)
  - #17 contrast audit
  - #58 visual regression
  - #59 load test
  - #60 axe-core

## Done

- #1-#7 Trello core
- #8 hierarchy / #9 links / #10 components+versions / #11 sprints / #12 story-points+velocity / #13 roadmap+gantt / #14 wip+swimlanes+filters / #16 dashboards+gadgets / #22 time+SLA / #23 mentions+watchers+inbox
- #16b-α quick wins (10 changes — activity audit, schedule chip, focus link, etc.)
- #16b-β workspace store + realtime sync
- #16b-γ-A core gantt (status mapping, critical path, cascade, E2E)
- #16b-γ-B onboarding (templates + seed + first-run tour)
- #16b-γ-C usability (priority, cover, virtualize, favorites, recents, error pane, empty states)
- #16b-γ-D power+bulk+nav (palette, quick-add, [], multi-select, undo, cross-board, ws-search)
- #16b-γ-Gantt-Master (A1-9, B1-5, C1-10, D1-4 — 28 changes shipped in worktree)
- #16b-γ-G drag-first Gantt (G1-8 — row reorder, reparent, drag-paint, priority gutter, snap, auto-scroll, chip drag, E2E)
- **Epic-as-kanban / roadmap-first IA** — shipped 2026-05-04 (18 tasks; spec `docs/superpowers/specs/2026-04-30-epic-as-kanban-design.md`, plan `docs/superpowers/plans/2026-04-30-epic-as-kanban.md`). Roadmap is now the workspace landing surface; each epic opens a 5-column status kanban at `/w/[wsId]/e/[epicId]`. Migrations 0052-0054 + race-safe `ensureStatusList` resolver, `moveCardToStatus` action, `listEpicChildren` query helper, status-list unique partial index.

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
