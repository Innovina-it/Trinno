# Evidence — Unit D1 / feature-level (undo-redo-stack)

Unit: D1 cross-surface verification
Commits under test: 7e2d080 (A1), 68f07fa (A2), ed8f49f (B1), 561c396 (B2), 1028d83 (C1), 88076b3 (C2), d090c67 (E1)
Risk tier: 2 · Verifier: claude (autonomous run authorized by ali) · Date: 2026-06-11

Environment: user's running dev server localhost:3000 (next dev --turbopack, freshness proven — new hotkey/toast code observed live), local Supabase (127.0.0.1:54321), Playwright chromium, fresh @innovina.it signups with minimal seed.

Build / typecheck: pass (tsc --noEmit clean across all units)
Lint: pass (touched files clean; 1 pre-existing warning in untouched card-quick-view.tsx)
Unit tests: 443/443 in tests/unit (12 new bus tests + 6 new hotkey-classifier tests)
Roadmap static tests: 2 pre-existing failures (filter-bar, static-source) — A/B'd on clean HEAD BEFORE this feature: identical failures, not caused by it.

Real artifact observed (tests/e2e/undo-redo-stack.spec.ts, 2/2 passed; full app through real browser):
  - multi-step LIFO: due-date edit then label attach → two Ctrl+Z undid them newest-first, with "Undid: …" toasts naming each action
  - redo (E1): Ctrl+Shift+Z re-attached the label ("Redid: Added Important"), DOM attribute flipped back
  - focus guard: Ctrl+Z with focus in the title input produced NO app undo toast
  - banner regression: banner appears on push; DISMISS hides it and the entry remained keyboard-undoable (A1 semantic change verified)
  - cross-surface: milestone created on the roadmap, undone from the boards page after CLIENT-SIDE nav (g b chord), marker verified gone on return, Ctrl+Shift+Z recreated it (id rebirth via mutable binding)

Flake note: board test passed runs 1 and 3, failed once mid-batch on a timing wait (dev server under 3 parallel spec-run load); not reproducible standalone.

Known gaps (honest):
  - Gantt BAR DRAG undo (B1): GAP CLOSED 2026-06-12 — third test added to undo-redo-stack.spec.ts performs the real drag gesture (mouse down/sweep/up on the bar), then verifies Ctrl+Z restores the captured pre-drag start date and Ctrl+Shift+Z re-applies it. 3/3 green. (The repo's own gantt-drag suite remains blocked on a deeper issue: it predates the epic→sub-board pivot, ead4c80 — see follow-ups.)
  - cascade composite undo (B2) verified by code + unit-level bus tests only; needs a seeded dependency chain to exercise live.
  - full page refresh drops the stack — BY DESIGN (in-memory, documented in A1 spec and the e2e spec comments).
  - e2e runs created throwaway users/workspaces (ur-*/cf-*@innovina.it) on the dev DB, consistent with existing spec practice; cleanup not run.

Decision: PASS with the two declared live-gesture gaps (bar drag, cascade) — both have exact-inverse server paths verified at unit level.
Next action: feature complete pending Ali's Gate 4/5 review; optional follow-up = fix gantt spec email domain, then it doubles as the drag tripwire.
