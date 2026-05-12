# Performance Diagnosis: Browser Stall on Extended Use

**Date:** 2026-05-12
**Repo:** trello-foundation (Next.js 15, Supabase Realtime, Zustand)
**Symptom:** Browser becomes sluggish / unresponsive after an extended session with small data.

## Summary

The board feed and card activity are correctly capped at query time (50 and 30 rows respectively), so the user's claim that there is "no limit" is partially wrong. However, three real memory/CPU growth paths exist: (1) the Zustand board store accumulates comments from every Realtime event with no in-memory cap, causing the full `CommentsSection` to re-render on every board-wide CDC event; (2) `use-workspace-realtime.ts` lists the raw `boards` array object as a `useEffect` dependency, meaning the effect tears down and re-subscribes the whole workspace channel every time any workspace mutation causes a new `boards` array reference; and (3) `use-activity-sync.ts` calls `router.refresh()` on every `INSERT` to the `activity` table, triggering a full Next.js RSC re-fetch of the board page for every action by any user — including comment posts, label changes, moves, etc.

---

## Hypothesis 1 — Realtime Subscription Leak

**Status:** Ruled out (for board channel); Suspected (minor) for workspace channel.

**Evidence:**
- `hooks/use-board-realtime.ts` line 228: `useEffect(() => { … })` with a return of `() => { cancelled = true; if (channel) supa.removeChannel(channel); }` at line 554–555. Cleanup is correct and tied to `boardId` changes.
- `hooks/use-workspace-realtime.ts` line 66: same pattern, `supa.removeChannel(channel)` at line 347.
- However, `use-workspace-realtime.ts` line 351 includes `boards` (the raw array reference) in the dependency array. Every Zustand `upsertCard`, `upsertList`, etc. call that rebuilds an array in state will produce a new `boards` reference if the store spreads state, causing the workspace channel to unsubscribe and re-subscribe. Each re-subscription is clean, but during the churn window two channels can overlap momentarily, and repeated subscribe/unsubscribe cycles waste CPU and Supabase socket capacity.

**Severity:** Medium (workspace channel churn), Low (board channel — ruled out).

---

## Hypothesis 2 — Zustand Store Unbounded Growth

**Status:** Confirmed (comments array).

**Evidence:**
- `stores/board-store.ts` line 443–447:
  ```ts
  addComment: (c) =>
    set((state) =>
      state.comments.some((x) => x.id === c.id)
        ? state
        : { comments: sortByCreatedAt([...state.comments, c]) },
    ),
  ```
  No slice or cap guard. Every `comment.create` realtime event (routed through `use-board-realtime.ts`) appends to `state.comments` indefinitely for the entire browser session. A busy board with 200 comments/hour would accumulate thousands of objects over a multi-hour session.
- `CommentsSection` at `components/board/card/comments-section.tsx` line 26 reads `useBoardStore((s) => s.comments)` — the whole board's comment array, not just the open card's. Every `addComment` triggers a re-render of every open `CommentsSection`.
- No matching `MAX_COMMENTS` constant anywhere in `stores/board-store.ts` or `stores/workspace-store.ts`.

**Severity:** High.

---

## Hypothesis 3 — Activity Feed Re-renders

**Status:** Confirmed (cascading router.refresh), Ruled out (DOM list size — capped at 50).

**Evidence:**
- `components/board/activity-feed.tsx` line 93: `listActivityForBoard(token, boardId, 50)` — hard cap at 50, rendered server-side. The DOM list is bounded. ✓
- `hooks/use-activity-sync.ts` line 32–40:
  ```ts
  () => router.refresh(),   // fires on every activity INSERT
  }, [boardId, router]);
  ```
  `router.refresh()` is called on **every** `INSERT` into the `activity` table for the board. Since every comment, every card move, every label change, every assignment writes an `activity` row (as seen in `listActivityForBoard`'s result set), a moderately active board generates a `router.refresh()` on every single user action — by any user. `router.refresh()` in Next.js 15 re-fetches all RSC segments for the current route, including `ActivityFeed`, board layout, etc. Under concurrent multi-user activity this becomes a flood of full RSC re-renders.
- `ActivityFeed` is a Server Component with no `React.memo` or `useMemo`. It is a static render (not a Client Component), so memoization does not apply, but RSC re-fetches are expensive network round-trips.

**Severity:** High.

---

## Hypothesis 4 — Card Modal Mount/Unmount

**Status:** Ruled out.

**Evidence:**
- `components/board/card-modal.tsx` line 157–161: `useEffect` cleanup clears `descTimer` on unmount.
- Line 196–223: `window.addEventListener("keydown", onKey)` is properly cleaned up at line 223: `return () => window.removeEventListener("keydown", onKey)`.
- The `siblingNav` effect at line 184 has a guard (`if (!card.boardId || cardVisible) return`) and no side effects that outlive it.
- No stale refs or global listeners found without cleanup.

**Severity:** Low (no issue found).

---

## Hypothesis 5 — Drag Layer (dnd-kit Sensor Leak)

**Status:** Ruled out.

**Evidence:**
- `components/board/board-view.tsx` line 173–175: `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))` — sensor is created inside the component via dnd-kit's managed `useSensors` hook. dnd-kit handles sensor lifecycle internally through its `DndContext` unmount lifecycle. No raw `addEventListener` for pointer events outside of dnd-kit.
- `DndContext` at line 460 uses `id={`dnd-board-${board.id}`}` which scopes event delegation. No manual sensor disposal code needed or missing.

**Severity:** Low (no issue found).

---

## Hypothesis 6 — Comments / Talk Rendering (Unbounded DOM)

**Status:** Confirmed (unbounded DOM + full-board store subscription).

**Evidence:**
- `components/board/card/comments-section.tsx` line 26: reads `useBoardStore((s) => s.comments)` — the **full board comment array**, not filtered by card. Then line 55: `const cardComments = useMemo(() => comments.filter((c) => c.cardId === cardId), ...)`. The `useMemo` only narrows the rendered list; the store selector still subscribes to the entire `comments` slice.
- No pagination in `CommentsSection`. The rendered `<ul>` (line 303) maps all `topLevelComments` with nested `replies` recursively via `renderComment`. If a card has 200 comments, all 200 are in the DOM.
- No virtual scrolling, no "load more" button, no cap. The talk section (`card-modal.tsx` line 657–659) renders the full list every open.
- `listActivityForCard` in `lib/queries/activity.ts` line 56 defaults to `limit = 50` (overridden to 30 at the call site), which correctly caps the server-rendered activity. But comments come from Zustand, not from this query, so the cap does not apply to the Talk section.

**Severity:** High.

---

## Hypothesis 7 — Network/Auth Polling

**Status:** Ruled out (intervals); Partially confirmed (router.refresh flood — covered in H3).

**Evidence:**
- `lib/undo-bus.ts` line 58: `setTimeout` properly cleared at line 43 (`clearTimer`).
- `lib/use-nav-chords.ts` line 44: `clearTimeout(primeTimer)` present.
- `middleware.ts` (root): 318 bytes, no `setInterval` or `setTimeout` visible; is a Next.js edge middleware for session refreshing via cookie, no polling.
- No `setInterval` found anywhere in `lib/`, `hooks/`, or `stores/`.
- `components/nav/notification-bell.tsx` line 65–67: `pulseTimer` is a `setTimeout` cleared at line 125 (`if (pulseTimer) clearTimeout(pulseTimer)`) in the cleanup — correct.

**Severity:** Low (no issue found).

---

## Hypothesis 8 — Module-Scope Memory Caches

**Status:** Partially confirmed (errorBus entries unbounded).

**Evidence:**
- `lib/errors/error-bus.ts` line 53: `state.entries = [entry, ...state.entries]` — prepends on every `push()`. `dismiss(id)` removes individual entries, but `push` has no maximum entry count guard. If actions fail in a loop (e.g., a network outage during bulk operations), entries accumulate indefinitely for the session. This is a module-scope singleton (not garbage-collected on navigation).
- `lib/use-command-palette.ts` line 7: `const listeners = new Set<() => void>()` at module scope — functions are added via `useSyncExternalStore`'s `subscribe` call and removed on unmount (the return value of `subscribe`). This is correct.
- `lib/undo-bus.ts` line 27: `listeners: new Set()` — same pattern, properly unsubscribed via returned cleanup function.
- All `new Map()` / `new Set()` usages in `lib/board-filters.ts`, `lib/aggregate-kanban/group.ts`, etc. are created inside function bodies on each call, not at module scope — they are not persistent caches.

**Severity:** Low (errorBus can grow but only under repeated errors; unlikely to be primary cause).

---

## Hypothesis 9 — DOM Portal Leaks

**Status:** Ruled out.

**Evidence:**
- `components/roadmap/roadmap-bar.tsx` line 466: `createPortal(…)` is conditionally rendered — it is inside the JSX return and gated by `{tooltipOpen && !menu && tooltipPos && typeof document !== "undefined" && createPortal(…)}`. React unmounts the portal content when `tooltipOpen` becomes `false`. No manual `document.body.appendChild` / `removeChild`.
- Tooltip close is handled by `cancelTooltip()` at line 170 (`setTooltipOpen(false)`) called on `mouseleave`, and `useEffect` at line 176 clears the `tooltipTimer` on unmount.
- Radix UI `AlertDialogPrimitive.Portal` in `components/ui/alert-dialog.tsx` line 21 uses Radix's managed portal lifecycle — correct.
- No `document.createElement` + manual DOM insertion found in `components/ui/`.

**Severity:** Low (no issue found).

---

## Top 3 Suspects Ranked

### 1. `router.refresh()` flood from `use-activity-sync.ts` (HIGH)

Every user action that writes an `activity` row (comment, move, label, archive, assignment — essentially every mutation) fires `router.refresh()` via the `INSERT` CDC subscription in `use-activity-sync.ts` (line 32). In Next.js 15, `router.refresh()` re-fetches all RSC payloads for the current route segment tree. On a board with four active users each performing ten actions per minute, the browser receives forty full RSC re-renders per minute. Each re-render rehydrates the board layout, activity feed, and any other RSC segments, building and diffing a new React tree. Over an hour session this is 2,400+ re-render cycles. The fix: replace the `router.refresh()` call with a more targeted invalidation. Since `ActivityFeed` is a Server Component that re-runs its query on refresh, either (a) convert it to a Client Component that appends from the Zustand store (which already receives `activity` CDC events via the board realtime hook) with a 50-entry cap, or (b) keep the RSC approach but debounce `router.refresh()` — coalesce rapid-fire CDC events into a single refresh call using a ref-stored `setTimeout` of 2–3 seconds, clearing and resetting the timer on each event.

### 2. Unbounded `state.comments` array in `board-store.ts` causing `CommentsSection` re-renders (HIGH)

`addComment` in `stores/board-store.ts` (line 443) appends every incoming Realtime comment to the global `state.comments` array without any cap. `CommentsSection` (line 26) subscribes to the entire array via `useBoardStore((s) => s.comments)`, so every new comment on any card triggers a re-render of every currently-mounted `CommentsSection`. In a long session with 500+ comments accumulated in memory, each re-render must filter, sort, and diff a growing list. The fix has two parts: (a) in `board-store.ts`, add a cap in `addComment` — after appending and sorting, trim to the most recent N entries per card: `{ comments: sortByCreatedAt([...state.comments, c]).filter((x) => …).slice(-200) }` (global cap of ~200 is safe); (b) in `CommentsSection`, narrow the store selector to only the comments for the current card: `useBoardStore((s) => s.comments.filter((c) => c.cardId === cardId))`, or better, expose a `selectCardComments(cardId)` selector that uses a stable reference via `useShallow`. This prevents unrelated card comment events from re-rendering the open modal.

### 3. `boards` array reference instability causing workspace channel churn in `use-workspace-realtime.ts` (MEDIUM)

`use-workspace-realtime.ts` line 351 lists `boards` (the raw `Board[]` array from the workspace store) as a `useEffect` dependency. Zustand's `createStore` produces a new array reference whenever any mutation touches state — including `upsertCard`, `upsertList`, etc. (these use spread, e.g. `[...st.lists, l]`). Because `boards` is a top-level state property read via `useWorkspaceStore((s) => s.boards)`, if `setSnapshot` or any action that causes a state spread also updates `boards` by reference, the effect tears down the `ws:${workspaceId}` Supabase channel and immediately re-creates it. Each cycle involves a websocket unsubscribe + re-subscribe. The fix: replace `boards` in the dependency array with a stable derived value — either `boards.map(b => b.id).join(',')` stored in a ref, or use `useShallow` / `useMemo` to stabilize the board IDs array. The channel only needs to re-register when the set of board IDs changes, not when card/list data within them changes.

---

## How to Confirm in Browser (Chrome DevTools)

### Confirm Suspect 1 — router.refresh() flood

1. Open the board in Chrome. Open DevTools → **Network** tab. Filter by `Fetch/XHR`. Set the filter text to `_rsc` (Next.js RSC requests use this prefix in their URL or the `RSC: 1` request header).
2. Perform five rapid actions (e.g., move a card, add a label, post a comment, archive a card, move another card).
3. Count the number of `_rsc` or full-route fetch requests fired. Each should correspond to one `router.refresh()`. If you see 5–10 network requests for 5 actions, Suspect 1 is confirmed.
4. Also check **DevTools → Performance tab → Record**. Start recording, perform 10 actions in 30 seconds, stop. Look for recurring "Re-render" tasks in the Timings lane and repeated long tasks in the main thread. Each `router.refresh()` will appear as a cluster of React reconciliation work.

### Confirm Suspect 2 — unbounded comments memory

1. Open DevTools → **Memory** tab. Click **Take heap snapshot**. Label it "baseline".
2. Open 10 different cards in sequence, closing each modal between opens. On a busy board, each card open loads its comments into `state.comments`.
3. Take a second heap snapshot. In the **Comparison** view, filter by `Array` or search for `CommentRow`. Check whether the retained size of the comments array grows proportionally to the number of cards visited.
4. Alternatively: In the **Performance** tab, enable **Memory** checkbox. Record a 2-minute session of normal use. Look for a saw-tooth JS heap that never drops back to baseline — this indicates retained comment objects from previous cards.

### Confirm Suspect 3 — workspace channel churn

1. Open DevTools → **Console**. Supabase Realtime logs channel lifecycle events. Run: `window._supabase = window.__SUPABASE_CLIENT__` if the client is exposed, or add a temporary `console.log` in `use-workspace-realtime.ts` inside the cleanup return: `console.log('[ws] channel removed', new Date().toISOString())`.
2. Perform normal board operations (move a card, rename a list). Check whether the log fires repeatedly within seconds of each action.
3. Without the log patch: in the **Network** tab, filter by `WebSocket`. Click the active Supabase socket. In the **Messages** pane, watch for `unsubscribe` + `subscribe` message pairs for the `ws:${workspaceId}` channel shortly after each mutation.
