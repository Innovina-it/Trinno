# Unit A1 — undo bus → bounded undo/redo stacks

Unit: A1-undo-bus-stack
Owner: ali (build lane: self)
Date: 2026-06-11
Status: DRAFT — awaiting Gate 1

Goal: Rebuild `lib/undo-bus.ts` from a single-entry 8s bus into a bounded 50-entry undo stack + redo stack, with optional `redo()` per entry, 10-minute lazy max-age prune, and banner-compatible surface. Zero call-site changes.

Done looks like:
  - `push({message, undo})` (old shape) and `push({message, undo, redo})` (new) both accepted; old shape compiles unchanged at all 41 sites
  - pushes accumulate: 5 pushes → 5 sequential `undo()` calls revert in LIFO order
  - 51st push drops the oldest entry (cap 50)
  - new `undo()` pops top, runs its callback, returns the entry (null if stack empty); entry moves to redo stack ONLY if it has `redo`
  - new `redo()` pops redo top, runs `redo()` callback, returns entry; any new `push` clears the redo stack
  - entries older than 10 min silently pruned from both stacks (lazy, on push/undo/redo)
  - banner: still shows latest push for 8s; its UNDO button (bus.invoke) = undo of stack top; dismiss hides banner but entry STAYS undoable; 8s expiry hides banner but entry STAYS in stack
  - unit tests in `tests/unit/undo-bus-stack.test.ts` cover: LIFO, cap, redo-clear-on-push, age prune (fake timers), dismiss/expiry keep entry, undo-failure → no redo push, listener contract, old-shape compat

Must not change:
  - `push` call signature byte-compatible — none of the 41 sites edited in this unit
  - banner component untouched: `subscribe` still emits "current banner entry | null", `invoke()` still exists and undoes, `dismiss()` still hides banner
  - undo callback errors still swallowed by the bus (sites surface their own toast/rollback — pattern at card-modal.tsx:738)
  - in-memory only, lost on refresh, "use client" module, zero new dependencies
  - `snapshot()` keeps returning the banner-visible entry (existing tests/usages); new internals exposed via a separate test-only accessor
  - `_resetForTests()` clears everything (stacks + banner + timers + counter)

Risk tier: 2
Blast radius: every undo interaction app-wide (41 board sites + banner) — but via behavior of one lib file; no UI files touched.

Dependencies: none (first unit)
Read-set: lib/undo-bus.ts, components/undo-banner.tsx, representative call sites (card-modal, labels-section)
Write-set: lib/undo-bus.ts, tests/unit/undo-bus-stack.test.ts
Parallel-safe with: nothing (every later unit consumes this API)

Verification preconditions:
  - seed data: none (pure lib + tests)
  - test users: none
  - env: vitest (`pnpm test:unit` / litmus suite if registered); dev server for banner regression
  - rollback path: git revert of the unit commit (single file + test file)

Tripwire checks: existing unit suite green (no regressions in tests touching undoBus/snapshot)
Per-unit checks: each "Done looks like" line above has a matching unit test; banner regression checked in the real app
Real-artifact check: dev server → make 3 board edits (label, priority, due) → banner appears each time, UNDO button reverts the last one, dismiss hides banner. NOTE: multi-step walking is keyboard-driven and only observable after A2 — until then stack depth is proven by unit tests only (declared gap, closes in A2's evidence).
Cold observer needed? no (Tier 2, covered by D1 feature-level evidence later)

Rollback plan: git revert <unit commit>; no data, no env, no migration.

Agent handoff notes (self lane): do not touch undo-banner.tsx or any call site; keep exported names (`undoBus`, `UndoEntry`) stable; add new exports rather than renaming.
Known unknowns: whether litmus has this repo registered (checked at dispatch); any test that asserts the old "new push replaces entry" semantics would now fail and must be updated deliberately, not silently.
Commit name: feat(undo): bounded undo/redo stacks in bus (50 entries, 10-min age)
