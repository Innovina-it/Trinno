# Evidence — Unit A1 (undo bus → bounded stacks)

Unit: A1-undo-bus-stack
Commit: 7e2d080 feat(undo): bounded undo/redo stacks in bus (50 entries, 10-min age)
Risk tier: 2
Verifier: claude (self lane), autonomous run authorized by ali 2026-06-11
Date: 2026-06-11

Environment: local repo, vitest 4 (node env)
Seed / test user: none needed (pure lib)

Build / typecheck result: pass (tsc --noEmit, no errors)
Lint result: pass (eslint on both changed files)
Unit + integration test result: 437/437 pass across 180 suites (12 new in undo-bus-stack.test.ts)

Tripwire result:
  - full existing unit suite re-run post-change: pass (no test asserted the old replace-on-push semantics)
  - litmus: project NOT registered for this repo (resolve_project → registrationNeeded) — vitest run directly instead

Per-unit check result:
  - Goal path (LIFO multi-undo): pass — test "accumulates entries and undoes in LIFO order"
  - 50-cap: pass — test drops oldest at 51
  - redo mechanics: pass — replay, return-to-undo-stack, clear-on-push, only-when-redo-provided
  - 10-min prune: pass — fake-timer test, both stacks
  - MNC push compat: pass — legacy-shape test + zero call-site edits in diff + full suite green
  - MNC banner contract: pass — subscribe/snapshot/dismiss/invoke tests; undo-banner.tsx untouched
  - MNC error swallow: pass — failed-undo test (not-ok, not redoable, no throw)
  - MNC in-memory/no deps: pass — no new imports; module state only

Real artifact observed:
  - NOT yet — banner regression in the running app deferred to the A2 evidence pass (one dev-server session covers both units' browser checks)

Cold observer: n/a (Tier 2; feature-level D1 covers cross-checks)

Known gaps:
  - real-browser banner regression pending (closes in A2 evidence)
  - multi-step walking not user-observable until A2 ships hotkeys (by design)

Decision: pass (with the two declared gaps carried to A2)
Next action: Unit A2 — hotkeys hook.
