# Unit B1 — Gantt drag/resize/lane-move undo+redo

Unit: B1-gantt-drag-undo · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: every bar-drag commit in the roadmap drag harness pushes an undo+redo entry: date reschedule (drag/resize via persistDates), priority gutter drop, lane reparent. Move-to-board deferred to B2 (its failure modes are richer).
Done looks like: drag a bar → Ctrl+Z restores dates (toast "Undid: Rescheduled …") → Ctrl+Shift+Z re-applies; same for gutter priority and lane reparent; failed undo/redo writes revert their optimistic patch and toast.
Must not change: cascade prompt fires only on the ORIGINAL forward action (undo/redo of one card never re-prompts cascade); click-to-open on no-move; snap behavior; cross-board/cycle error messaging (errorBus paths); realtime echo reconciliation comment semantics.

Risk tier: 2 · Blast radius: roadmap drag commits (all of them).
Write-set: components/roadmap/use-roadmap-drag-harness.ts only.
Verification: tsc/eslint; existing roadmap tests; real-browser in D1. No new unit tests (hook is DOM-bound; logic delta is push payloads — covered by A1 bus tests + D1 live pass).
Rollback: git revert unit commit.
Commit name: feat(roadmap): undo/redo for bar drag, resize, gutter priority, lane reparent
