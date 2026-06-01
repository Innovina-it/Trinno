# Known issue — roadmap completion not reflected after a hard reload

**Date:** 2026-06-01
**Severity:** Cosmetic / low. Pre-existing (predates the completion↔done feature; reproduces with the old `updateCard` path too).
**Status:** Open, deferred.

## Symptom

Tick a card complete on the workspace roadmap (`/w/<id>/roadmap`). It flips
to completed immediately (optimistic) and persists in the DB. But after a
**hard reload** of the roadmap, the bar renders as **not completed**
(`[data-testid="roadmap-bar-complete-toggle"][data-completed="false"]`) — the
lime ring / strikethrough is gone, even though `cards.completed_at` is set.

Live behavior is correct: the optimistic patch + realtime (CDC) keep the bar
completed while the page stays open. Only a fresh document load loses it.

## What is NOT the cause (verified)

The completion value travels intact through the whole data path:

- `getWorkspaceSnapshot` SELECTs `completedAt` (`lib/queries/workspace-snapshot.ts:252`) and returns the rows directly (`cards: cardRows`, ~:369).
- Store seed is a passthrough: `cards: initial.cards` (`stores/workspace-store.ts:100`).
- Realtime mappers carry it: `rowToCard` in `hooks/use-board-realtime.ts:61` and `hooks/use-workspace-realtime.ts:41` both set `completedAt`.
- The roadmap bar array maps it: `components/roadmap/roadmap-view.tsx:~826` reads `c.completedAt` from `storeCards`.

So the snapshot → provider → store → view chain all carry `completedAt`.

Note: `listRoadmapCards` (`lib/queries/roadmap.ts`) does NOT select
`completed_at`, but that query only feeds the header card **count**
(`{cards.length} CARDS` in `roadmap/page.tsx`), not the bars — changing it
does not fix this.

## Suspected location

A client/runtime drop between store hydration and the bar render that static
analysis didn't surface — e.g. a memoized bar array with stale deps, an
on-mount re-seed, or a per-card store lookup feeding `<RoadmapBar>` at
`roadmap-view.tsx:~2544` that differs from the 826 mapping. Needs in-browser
debugging (log `storeCards[i].completedAt` at first render after reload).

## Reproduction (E2E)

```
signup+seed -> /w/<id>/roadmap -> tick complete (data-completed=true) ->
reload roadmap -> assert data-completed=true   // FAILS: observed "false"
```

The committed E2E spec (`tests/e2e/roadmap-completion.spec.ts`) deliberately
stays in a single live session for this reason; a reload-persistence test
would fail on this issue.

## Not affected

The feature itself is correct and fully covered server-side:
`tests/integration/roadmap-completion.test.ts` (INT-01..17, REGR-*, AUTH-*,
24 tests) + DB verification confirm complete → card in Done list +
`pre_done_list_id`, reversion, no-yank, auto-create Done, and authorization.
