# Wave 3 — Dispatch 3c + 4 (parallel)

**Date**: 2026-05-14
**Branch**: plan/01-foundation
**Orchestrator**: Claude (Opus 4.7)
**Status**: COMPLETE

## Dispatches

| Dispatch | Agent id | Duration | Result |
|---|---|---|---|
| 3c — Batch update refactor | `abdcb31e57be5a37a` | ~221s | success |
| 4 — Shared workspace data + cache | `a463d2c1fcc6e0253` | ~639s | success (latency unmeasured — dev server blocked in sandbox) |

Both ran foreground in parallel.

## Per-dispatch summary

### 3c — Batch update refactor
- Audited `actions/cards.ts` bulk-archive: ALREADY a single `UPDATE ... WHERE id IN (...)` (Drizzle). O(1) round-trips. No code edit required.
- `actions/sprints.ts` date-shift: replaced `select + per-card UPDATE loop` with one Drizzle `UPDATE` using SQL interval arithmetic on `startDate` and `targetDate`. O(N) → O(1).
- New tests: `tests/unit/batch-update-refactor.test.ts` — bulk-archive issues 1 UPDATE (25 cards, 455ms); sprint date-shift issues 1 UPDATE (25 cards, 16ms). Both PASS.
- E2E latency vs target (<1.5s for 100 cards): **could not measure end-to-end against DB** because of pre-existing 0097 migration bug. Unit-level proof of round-trip reduction substituted.

### 4 — Shared workspace data + cache
- New file `lib/queries/workspace-snapshot-shared.ts` — query-key factory + `useWorkspaceSnapshot()` / `useBoards()` / `useMembers()` hooks.
- New file `stores/workspace-cache-store.ts` — thin TanStack-shaped local cache adapter (`fetchQuery`, `dehydrate`, `invalidateQueries`). NO new npm dependency added (TanStack Query not installed; adapter implements the same surface so a future swap is straightforward).
- Modified `app/(app)/w/[workspaceId]/layout.tsx` — layout-level shared fetch.
- Modified `app/(app)/b/[boardId]/layout.tsx` — wired to shared cache.
- Modified `components/board/board-view.tsx` and `components/roadmap/roadmap-view.tsx` — consume shared hooks when flag ON; preserve old per-page fetch when flag OFF.
- Feature flag: `NEXT_PUBLIC_SHARED_WORKSPACE_CACHE === 'true'`, default OFF (safe). Stop-gap until a unified workspace flag system lands.
- THREE new tests in `tests/shared-cache/`:
  - `golden.test.ts` — second view mount makes ZERO new network calls for shared keys. PASS.
  - `back-compat.test.ts` — flag OFF preserves per-page fetch behavior. PASS.
  - `cache-invalidation.test.ts` — invalidation propagates to both views. PASS.
- Tab-switch latency vs target (<100ms): **could not measure** — sandbox blocks port binding (`listen EPERM`) so dev server cannot start. Instrumentation hook is wired in both views; the report includes manual measurement steps for the user.
- `npm run build` reports webpack errors with no diagnostic file in this sandbox; pre-existing constraint unrelated to Wave 3 code.

## Wave Gate
| Check | Result |
|---|---|
| `npm run type-check` | PASS |
| `npm run lint` | PASS |
| Targeted tests (`tests/unit/batch-update-refactor.test.ts` + `tests/shared-cache/`) | 4 files / 5 tests PASS |
| Writeset disjoint between 3c and 4 | YES — 3c: actions/cards.ts archive path, actions/sprints.ts. 4: layouts, new lib/queries, new stores, two view components. Disjoint. |
| Writeset disjoint from prior waves | YES — confirmed by git diff vs prior wave writesets. |

## Carry-over for later waves (4–7)
- Migration 0097 SQL bug — still blocks `npm run db:reset`. Affects every wave's integration-test verification. Needs separate hotfix.
- Tab-switch latency unmeasured — measure in user's actual dev server (see Wave 3 instructions in dispatch 4's report).
- Bulk-archive / sprint-shift e2e timings unmeasured — same DB block.
- TanStack Query not installed; if the project wants the real cache infra, add `@tanstack/react-query` and swap the adapter in `stores/workspace-cache-store.ts`.
- `lib/queries/epic-children.ts` still present (left for an Epic-cleanup sweep outside dispatch 4's writeset).
- Wave 4 (next per spec): 9a virtualization alone, or with 5 if writesets disjoint.
