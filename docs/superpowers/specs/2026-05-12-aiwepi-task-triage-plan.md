# AIWEPI Task Triage — Full Implementation Plan

**Date**: 2026-05-12
**Source**: 25-row task triage (user screenshot, see chat)
**Mode**: Codex-rescue dispatched, phase-gated
**Status**: Draft, awaiting user green-light

---

## Decisions (user-confirmed)

1. **My Tasks** — keep page, keep name. No removal.
2. **Epic boards** — surface epics on `/w/[ws]/boards`. Same tile shape as boards, distinguished by `Epic Board` tag.
3. **Roles** — documentation only (`docs/roles.md`). No in-app permissions UI in this batch.

## Out of scope

- Task 25 (Sprint) — TBD per user.

---

## Phasing

Six phases. Each phase = one or more codex:rescue dispatches. Phase N+1 starts only after Phase N verified and committed.

### Phase 1 — Diagnose & Document (parallel, 3 dispatches)

| # | Task | Type | Output |
|---|---|---|---|
| 1 | Roles model | doc | `docs/roles.md` describing 3-tier role system (workspace/board/dashboard) with permission matrix |
| 2 | Card click opens new URL instead of in-page modal | bug diagnosis | Root-cause report. Intercept route `@modal/(.)c/[cardId]` exists — find why it falls through to the full-page route. Hypotheses: middleware redirect, hard nav, `scroll={false}` lost, viewport breakpoint |
| 4 | Browser stuck after a while | perf diagnosis | Profiling report. Suspects: realtime subscription leak, audit trail re-renders, card modal not unmounting. Activity cap is already 50/30 — not the cause. Need traces |

**Gate to Phase 2**: diagnosis docs reviewed by user. Fixes for tasks 2 and 4 dispatched as part of their fix-phase (likely P3 for #2 since card detail UX, separate spike for #4).

### Phase 2 — Data Cleanup (1 dispatch, low risk)

Single codex agent rewrites `scripts/seed-aiwepi.mjs` and `scripts/seed-aiwepi-team.mjs`. Re-seedable.

| # | Task | Change |
|---|---|---|
| 15 | Deliverable descriptions missing | Add `description` to every D1.x.x subtask in seeds |
| 16 | WP name == Task name | Audit seed for collisions; rename Tasks if any match WP names (recon says none currently, but verify) |
| 17 | Milestones become new roadmap primitive (decided: Versions stay, Milestones = new concept) | Moved to P3.5 — new schema + UI. See below. |
| 18 | Task descriptions missing | Add `description` to every T*.* story card in seeds |
| 19 | AIWEPI start date | Hardcode `START_DATE = 2025-10-15T09:00:00Z` instead of `today` in both seeds. Recompute M1–M5 offsets |
| 20 | Italian content → English | Translate WP titles, descriptions, kinds, task names. Preserve IDs (T1.1 etc.) |

**Verification**: re-run seed against a scratch DB, spot-check sample cards.

**Gate to Phase 3**: seed scripts merged.

### Phase 3 — Roadmap Pass (sequential, 1 file owner)

`components/roadmap/roadmap-view.tsx` + `lib/roadmap/layout.ts` carry all six tasks. Sequential to avoid merge conflicts on the same file.

| # | Task | Files | Spec |
|---|---|---|---|
| 8 | Lane name truncated | `roadmap-view.tsx:1153-1169` | Replace `.truncate` with title tooltip + multi-line clamp OR widen `LANE_LABEL_WIDTH` to fit P95 lane name. Likely tooltip + clamp-2 |
| 9 | Gantt not responsive to viewport | `roadmap-view.tsx:71, 1198` | Replace hardcoded `LANE_LABEL_WIDTH=200` with min/max + ResizeObserver. Canvas already uses `flex-1`; verify layout below the breakpoint defined in mobile spec |
| 11 | Subtask filter hides parent tasks | `lib/roadmap/layout.ts` | When `hideSubtasks=false`, ensure parents always render even if filter excludes parent type. Subtask rows indented under parent regardless of parent filter state |
| 5 | New-card form vs edit inconsistency | `components/board/add-card-form.tsx` + `card-modal.tsx` | Add quick-edit fields to edit form OR strip edit modal of fields not in new-card form. Decision per shape phase. Specifically: assignee picker must exist in BOTH paths |
| 10 | New card in gantt missing owner + not in todo | roadmap inline create handler | When user creates card on gantt, default owner to current user, default list to first "todo" list of the board. Currently lacks both |
| 6 | Listview ordered by start date | new component | Add `<ListView>` toggle to roadmap. Tree: epic → task → subtask, ordered by `startDate ASC`. Subtasks indented |

**Verification**: Playwright tests on roadmap responsive breakpoint, lane truncation, listview render, create-from-gantt smoke.

**Gate to Phase 3.5**: P3 PR merged.

### Phase 3.5 — Milestones primitive (sequential after P3)

User decision: Versions stay as-is. Milestones = a new first-class concept on the roadmap, distinct from Versions.

| Item | Spec |
|---|---|
| Schema | New table `milestones` (id, workspace_id, board_id NULL, name, date, color, icon, description, created_at). Drizzle migration. RLS by workspace |
| Roadmap render | Vertical marker line at `date` across the gantt canvas. Label flag at top. Color from milestone row. Tooltip with name + description |
| CRUD UI | Workspace settings: list/create/edit/delete milestones. Quick-create inline from gantt (right-click empty date → "Add milestone here") |
| Card link (optional, future) | Defer. Just markers for now |
| Filter | Toggle "Hide milestones" in roadmap toolbar |

**Verification**: create 3 milestones in seed, render on roadmap, edit/delete cycle.

**Gate to Phase 4**: P3.5 PR merged.

### Phase 4 — Filters + Cross-Workspace (parallel, 2 dispatches)

`lib/board-filters.ts` is already unified. Extension work.

| # | Task | Files | Spec |
|---|---|---|---|
| 3 | "Assigned to Me" on Roadmap / Board / All Tasks | `lib/board-filters.ts`, `roadmap-view.tsx`, `all-tasks/page.tsx` | Hook `parseFilters`'s `assignedToMe` into Roadmap and AllTasks. UI: filter chip in toolbar of each surface |
| 21 | Show unassigned tasks everywhere | `lib/board-filters.ts` | Add `unassigned` filter flag. URL param `assignee=none`. Toggle in same filter chip group |
| 22 | Cross-workspace timeline | new route `app/(app)/me/timeline/page.tsx` OR extend `/me` | Query open cards across all user's workspaces, render single gantt view. Use existing `roadmap-view` component fed with multi-workspace card set |
| 23 | "Mine + all workspaces" UX | filter UI | Re-spec My Tasks filter so the two are independent toggles, not mutually exclusive. Currently confusing. Add label clarity |

**Verification**: filter persistence in URL, assignedToMe + cross-workspace combine without dropping cards.

**Gate to Phase 5**: P4 PR merged.

### Phase 5 — UX Polish (parallel, 4 dispatches)

| # | Task | Files | Spec |
|---|---|---|---|
| 7 | Workspace create — choose members | `components/workspace/create-workspace-dialog.tsx`, `actions/workspaces.ts:19-34` | Add member multi-select to dialog. On submit, insert workspace_members rows in same transaction. Member options = all profiles the creator can see (handle privacy here — likely all profiles in same auth org) |
| 13 | My Tasks renamed/clarified | none — keep as-is per user | No code change. Memory: decision logged. |
| 14 | Epic boards on boards page | `app/(app)/w/[workspaceId]/boards/page.tsx`, board tile component | Query cards `where type='epic'` in workspace. Render alongside boards. Add `<Tag>Epic Board</Tag>` label on tile. Click → opens epic detail modal (the existing intercept) |
| 24 | Subtasks not shown on board | `components/board/board-view.tsx`, card-tile | Render subtask count badge on parent card. Optional: expand-in-place to show subtask titles. Spec: badge first, expand later if user asks |

**Verification**: Playwright happy-path each surface.

**Gate to Phase 6**: P5 PR merged.

### Phase 6 — Session Lifetime (1 dispatch)

| # | Task | Files | Spec |
|---|---|---|---|
| 12 | Web session must last longer | Supabase project config (dashboard) + `lib/supabase/middleware.ts` if applicable | Default Supabase JWT expiry is 1h; refresh token is 30d. Investigate whether user is hitting JWT expiry without refresh, or if middleware is forcing re-auth. Likely just bump Supabase project setting `JWT expiry` to 8h. Code change minimal |

**Verification**: leave a tab idle 4h, return, no re-login prompt.

---

## Codex dispatch protocol

For each dispatch:

1. **I write a brief** containing:
   - Task ID and short title
   - File paths from recon
   - Acceptance criteria (3–5 bullets)
   - Test commands (lint, typecheck, vitest, playwright if applicable)
   - "Don't touch" list (out-of-scope files)
2. **I dispatch via `codex:codex-rescue` subagent** with `isolation: worktree` so changes are isolated.
3. **Codex returns** diff + run report.
4. **I verify**:
   - Read diff
   - Run lint + typecheck + targeted tests on the worktree
   - Check acceptance criteria
   - If drift: re-dispatch with corrections
5. **I summarize** for user, request approval to merge worktree → branch.
6. **I commit** with conventional commit message.

## Branch strategy (decided)

- Current branch: `plan/01-foundation`
- Per phase: sub-branch `phase/NN-name` cut from `plan/01-foundation`
- After verify: PR `phase/NN-name` → `main`
- One PR per phase. Smaller diff = faster review = easier rollback
- After merge to main, rebase `plan/01-foundation` onto main before next phase
- Codex isolation: worktree per dispatch (`isolation: "worktree"`)

## Open uncertainty

- **Task 4 (perf)**: until diagnosis returns, scope is unknown. Could be 1h or 1 week.
- **Task 17 (Milestone vs Version)**: user used "Milestones had become Version ??" — implies they want the UI to say Milestone, not Version. Confirm before P2.
- **Task 14 (Epic boards)**: spec assumes epic detail opens existing modal. If user wants a dedicated "epic-as-board" view (kanban of epic's child tasks), scope grows by ~1 day.

## Next step

User confirms phasing → I dispatch P1 (three parallel codex agents).
