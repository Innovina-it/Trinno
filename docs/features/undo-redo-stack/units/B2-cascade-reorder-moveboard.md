# Unit B2 — cascade composite, row reorder, move-to-board undo+redo

Unit: B2-cascade-reorder-moveboard · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: the three remaining Gantt mutations push undo+redo entries; cascade is ONE composite entry covering all server-reported shifted cards.
Done looks like: confirm a cascade → one history entry "Shifted N dependent cards"; Ctrl+Z restores ALL N (exact id set, −delta replay, no graph re-walk); reorder a row → undo returns it between its original neighbours; move card to another sub-board lane → undo moves it back.
Must not change: cascade confirm flow (Skip leaves dependents untouched; root drag stays a separate entry per spec); reorder rank semantics (sparse-rank service round-trip); moveCardToBoard list-snap + error messages (CROSS_BOARD_*); guest blocking (#0111) on the new action.
New server action: shiftCardsByIds (exact inverse/replay; zod-capped 500 ids ±365 days; guest check + RLS partial application like bulk actions; no revalidatePath — CDC reconciles).

Risk tier: 2 · Blast radius: roadmap cascade/reorder/cross-board move; one new server action on cards.
Write-set: use-roadmap-drag-harness.ts, cascade-confirm-dialog.tsx, actions/cards.ts, lib/validation.ts.
Verification: tsc/eslint clean; unit+roadmap suites — only the 2 pre-existing failures (A/B'd against HEAD, present before this feature; filter-bar + static-source). Real-browser in D1.
Known unknowns: undo of reorder relies on original neighbours still existing (server errors → toast, honest failure); cascade undo after graph edits still shifts the exact original id set — documented behavior.
Rollback: git revert unit commit.
Commit name: feat(roadmap): undo/redo for cascade shifts, row reorder, move-to-board
