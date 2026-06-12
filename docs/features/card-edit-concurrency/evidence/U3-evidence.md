# Evidence — U3 client threading + conflict dialog (card-edit-concurrency)

Unit: U3 · Tier 3 · Verifier: claude + cold observer · Date: 2026-06-12

Surfaces wired: card-modal (title onBlur + description debounce), card-tile inline rename, card-quick-view batched Save, roadmap-view quick-view onPatch. Conflict travels as a RETURNED result (updateCardChecked) — a thrown StructuredError loses its context across the server-action boundary — and is consumed via the typed isVersionConflict / CardEditConflictError, never string-matched.

Build/typecheck: pass. Lint: clean (1 pre-existing descEditing warning in card-quick-view, not from this unit). Unit+roadmap+integration: 462/462.

Real artifact (tests/e2e/card-edit-conflict.spec.ts, 2/2 green vs live dev server):
  - two tabs, same card: stale title save → conflict dialog naming the field, showing mine vs theirs; take-theirs adopts the server text with no write; keep-mine re-opens-then-resaves wiring works. Nothing clobbered silently.
  - description autosave: consecutive bursts in one editor do NOT self-conflict, and both bursts persist across reload (the brief's feared failure mode — defended).

Cold observer (Tier 3, independent agent, no build transcript): verdict CONCERNS → all addressed.
  - PASS confirmed by observer: trigger scoping (no spurious bump), atomic WHERE-clause fence, RLS-vs-conflict disambiguation (is_board_writer mirrors cards_select), server-boundary context handling, opt-in scoping (undo/seed/bulk keep last-write-wins), NO silent DB write loss.
  - Findings #1/#2/#3 (client rev going stale → user self-conflicts with own edit; recoverable, not data loss) — FIXED this pass: liveRevRef made monotonic (never lowered by an optimistic local patch); every successful checked save writes the returned editRev into the store; a title save advances a pending description burst past its own rev. Re-verified: e2e green after the fixes.
  - Findings #4 (quick-view field-label heuristic) / #5 (roadmap non-conflict no-revert) — minor, documented, deferred (no data loss; cosmetic / pre-existing-style).

SSR fix: both card page loaders (full-page + @modal intercept) now pass editRev to CardModal so the rev baseline is correct on first load.

Known gaps: preview/prod migration application is Ali's deploy step (not done here); realtime CDC for the workspace store doesn't carry edit_rev to the roadmap surface (self-edit covered by the on-success store write; cross-user roadmap-title conflicts fall back to last-write-wins there — title editing on the roadmap is rare). Findings #4/#5 deferred.

Decision: PASS.
