# Gantt Baselines — design

**Date:** 2026-06-02
**Status:** Approved (decisions locked via design discussion)
**Author:** Ali + Claude

## 1. Goal

Let an owner/admin **save the current roadmap as a named, immutable baseline** at any point, keep **multiple baselines** over the project's life, and at any time **compare the live Gantt against a chosen baseline** to see schedule variance (slip, pull-in, added, removed, completed, ownership/milestone changes). The live `cards` stay the single source of truth; baselines are frozen reference copies.

This is **Model A (baselines)** only. Editable "scenario" plans (Model B) are explicitly out of scope.

## 2. Terminology & relationship to existing concepts

- **Baseline** = a frozen capture of the roadmap's scheduling data at a moment.
- **Actual / live** = the current state computed from `cards` now. **The default view for all users is the live roadmap** ("the actual baseline is the live roadmap").
- **Variance** = the per-task difference between live and a chosen baseline.
- Distinct from: `versions` ([0032](../../../supabase/migrations/0032_versions.sql)) = product releases; `milestones` ([0095](../../../supabase/migrations/0095_milestones.sql)) = dated markers; `card_field_history` ([0091](../../../supabase/migrations/0091_card_field_history.sql)) = per-field change log. A baseline is the missing "whole-schedule-at-time-T as one comparable, immutable object."

## 3. Locked decisions

| Topic | Decision |
|---|---|
| Model | A (baselines) only; no editable scenarios |
| Frozen per card | dates (start/target), completion, roadmap order, sprint/parent (grouping), **assignees** |
| Frozen workspace-wide | **milestones** (id, name, date) |
| NOT frozen | task descriptions (low schedule-signal, heavy storage) |
| Baseline record fields | `name` + `note` (the baseline's own description) |
| Mutability | **Immutable** captured schedule; **only `name`/`note` editable** |
| Comparison | **live-vs-baseline only** (no baseline-vs-baseline in MVP) |
| Default view | **live roadmap**; inspecting a baseline is an explicit opt-in with a visible compare-mode banner; compare defaults to the most recent baseline |
| Create / rename / delete | **owner + admin** only |
| View / compare | **all workspace members incl. guest** (read-only) |
| Capture trigger | **manual only** (no auto-baseline in MVP) |
| Retention | **soft cap 25** — saving at the cap prompts to delete an older one; never auto-delete |
| Realtime | none on captured data (immutable); `revalidatePath` on create suffices |

## 4. Data model

Four workspace-scoped tables. RLS follows the repo helpers (`is_workspace_member` / `is_workspace_admin` from [0003_rls.sql](../../../supabase/migrations/0003_rls.sql)), matching the link feature's conventions.

```sql
-- The baseline record (mutable metadata).
create table public.roadmap_baselines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  note         text,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index roadmap_baselines_ws_idx on public.roadmap_baselines (workspace_id, created_at desc);

-- Frozen per-card scheduling data (write-once).
create table public.roadmap_baseline_entries (
  baseline_id    uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id        uuid not null,              -- NO FK: a baseline must survive card deletion
  title          text not null,              -- denormalised so removed cards still render in the diff
  start_date     timestamptz,
  target_date    timestamptz,
  completed_at   timestamptz,
  roadmap_order  integer,
  sprint_id      uuid,
  parent_card_id uuid,
  primary key (baseline_id, card_id)
);

-- Frozen per-card assignees (write-once).
create table public.roadmap_baseline_assignees (
  baseline_id uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id     uuid not null,
  user_id     uuid not null,
  primary key (baseline_id, card_id, user_id)
);

-- Frozen milestones (write-once; NO FK to milestones so deletion is survivable).
create table public.roadmap_baseline_milestones (
  baseline_id  uuid not null references public.roadmap_baselines(id) on delete cascade,
  milestone_id uuid not null,
  name         text not null,
  date         timestamptz,
  primary key (baseline_id, milestone_id)
);
```

Key choices:
- **No FK on `card_id`/`milestone_id`** + denormalised `title`/`name`: a baseline stays truthful after a card/milestone is deleted ("was in the plan, now gone" is information). Immutability is the whole point.
- **Schedule fields only** (no description): matches what the Gantt renders + the locked frozen-set.
- **The three child tables are write-once**: rows are inserted at capture and only removed when the parent baseline is deleted (cascade). No action ever updates them.

### RLS (defense in depth — RLS + a TS guard)
```sql
alter table public.roadmap_baselines enable row level security;
create policy roadmap_baselines_select on public.roadmap_baselines for select
  using (public.is_workspace_member(roadmap_baselines.workspace_id, auth.uid()));
create policy roadmap_baselines_admin_write on public.roadmap_baselines for all
  using (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()));
```
The three child tables enable RLS and gate by membership of their parent baseline's workspace (a `select` policy via an `exists` join to `roadmap_baselines`; writes funnel through server actions under the admin policy on the parent). Captured data is never written after creation, so child-table write policies only need to allow the owner/admin insert during capture and cascade-delete.

## 5. Server actions (`actions/roadmap-baselines.ts`)

Mirror `actions/links.ts` (`requireUser → getSessionToken → dbAsUser → assertWorkspaceWriter → mutate → revalidate`, wrapped in `actionResult`).

- `createRoadmapBaseline({ workspaceId, name, note? })` — owner/admin. Enforces the soft cap (count >= 25 → `StructuredError('LIMIT_REACHED', …)`). Captures in one transaction:
  - insert the `roadmap_baselines` row;
  - `insert … select` entries from `cards` (join boards, `workspace_id = $ws`, `archived = false`);
  - `insert … select` assignees from `card_members` for those cards;
  - `insert … select` milestones from `milestones` where `workspace_id = $ws`.
- `updateRoadmapBaseline({ id, name?, note? })` — owner/admin. Updates ONLY the `roadmap_baselines` row. Never touches captured tables.
- `deleteRoadmapBaseline({ id })` — owner/admin. Cascade removes child rows.
- `getRoadmapBaselineDetail({ id })` — any member. Returns entries + assignees + milestones for the chosen baseline (lazy-loaded only when the user enters compare mode).

The baseline **list** (metadata only) is seeded into the workspace store via the workspace-snapshot loader; **details** load on demand.

## 6. Comparison engine (pure function, `lib/baselines/compare.ts`)

`compareToBaseline(live, baseline)` over two sets of per-card data → a variance result. Pure, unit-testable, no I/O.

| Variance | Computation | Display |
|---|---|---|
| Slip | `live.target − base.target > 0` | red, `+Nd later` |
| Pull-in | `live.target − base.target < 0` | green, `−Nd earlier` |
| Start shift | `live.start − base.start` | start moved |
| Duration change | `(live.target−live.start) − (base.target−base.start)` | grew/shrank |
| Newly completed | base `completed_at` null → live set | ✓ since baseline |
| Added | in live, not in baseline | hatched, "new since baseline" |
| Removed | in baseline, not in live | dashed ghost, "removed since baseline" |
| Reordered | `roadmap_order` delta | moved up/down |
| Assignee change | set diff of `user_id`s | "+X, −Y" owners |
| Milestone slip | `live.date − base.date` per milestone | milestone marker moved |

Workspace rollup (free): tasks slipped, worst slip, net scope change (added − removed), % complete vs baseline, milestone slips.

## 7. UI / UX

All controls hang off a **"Baselines"** entry in [roadmap-header.tsx](../../../components/roadmap/roadmap-header.tsx).

1. **Save baseline** — button → small dialog (name + optional note). Owner/admin only (hidden/disabled for others). Reuses link-dialog styling.
2. **Baseline manager** — dropdown listing baselines (name · date · author), newest first. Per row: **Compare** · **Rename** (name/note dialog) · **Delete** (owner/admin). Empty state: "Save your first baseline."
3. **Overlay (compare) mode** — selecting **Compare** enters comparison mode (lazy-loads detail), shows a **visible banner** ("Comparing against: <name>"), and draws each task's **baseline bar as a faint ghost outline behind the live bar** in [roadmap-bar.tsx](../../../components/roadmap/roadmap-bar.tsx), with a `+Nd`/`−Nd` delta chip on shifted tasks; milestones get a ghost marker at the baseline date. Default-off; explicit to enter; defaults to the most recent baseline. Exiting returns to the live-only view.
4. **Variance panel** — a side panel/table of only changed items, grouped Slipped / Pulled-in / Added / Removed / Completed / Assignee-changed / Milestone-moved, sortable by largest slip, with the workspace rollup at the top.

Visual encoding: ghost outline = baseline, solid = live; red = later, green = earlier, dashed = removed, hatched = added.

The user's **last-selected baseline + compare on/off** persists per-user in `user_preferences` JSONB (workspace-page nesting), consistent with existing roadmap/backlog prefs — but the global default remains live until the user opts in.

## 8. Stores / loading / realtime

- **Baseline list** (metadata) seeds into the workspace store via the workspace-snapshot loader (same pattern as the link feature).
- **Baseline detail** (entries/assignees/milestones) loads lazily via `getRoadmapBaselineDetail` when the user enters compare mode; cached in the workspace store keyed by baseline id.
- **Realtime:** captured data is immutable → no CDC. `revalidatePath` on create/rename/delete refreshes the list for the actor; a `LinksRealtime`-style subscriber on `roadmap_baselines` (list only) is a trivial later add if peers need live list updates.

## 9. Permissions

- **View / compare** (incl. open the variance panel and overlay): any workspace member, **including guest**. RLS select via `is_workspace_member`.
- **Create / rename / delete**: **owner + admin** only. RLS `is_workspace_admin` + an `assertWorkspaceWriter`-style TS guard in the actions (reuse `lib/permissions/workspace-writer.ts`).

## 10. Edge cases

- **Card deleted after baseline** → "Removed" (kept `title`); no broken join.
- **Card created after baseline** → "Added".
- **Undated in baseline, dated now (or vice-versa)** → "now scheduled" / "now unscheduled" instead of a day-delta.
- **Card archived after baseline** → reads as "Removed".
- **Milestone deleted/added** → removed/added in the milestone group.
- **Large workspaces** → capture is bulk `insert … select`; overlay only renders ghosts for currently visible/filtered bars (the Gantt already filters/virtualizes).
- **Soft cap** → at 25, save prompts to delete an older baseline; never auto-deletes.
- **Empty workspace / no baselines** → manager shows the empty state.

## 11. Testing

- **Unit**: `compareToBaseline` (every variance type incl. added/removed/assignee/milestone, undated edges); soft-cap guard; `assertWorkspaceWriter` reuse.
- **E2E (Playwright)**: owner saves a baseline → it appears in the manager; shift a card's date → compare shows the slip + ghost bar + delta chip; member can compare but not save/edit/delete (controls hidden); guest can compare read-only; rename updates metadata only; delete removes it.
- Note (project memory): vitest can't transform `@base-ui/react` → dialog/manager components tested via e2e; keep `compareToBaseline` and the cap guard as pure unit tests.

## 12. MVP phasing

1. Migration (4 tables + RLS) + `createRoadmapBaseline` + list loader.
2. Save-baseline dialog + baseline manager (list/rename/delete).
3. `getRoadmapBaselineDetail` + `compareToBaseline` (pure) + workspace-store detail cache.
4. **Overlay mode** (ghost bars + delta chips + milestone ghosts + compare banner).
5. **Variance panel** (table + rollup).
6. E2E.

Deferred (post-MVP): baseline-vs-baseline, dependency diff, auto-baseline triggers (sprint start / milestone close), realtime on the list, editable "scenario" plans (Model B).
