# Unit C1 — milestone undo+redo

Unit: C1-milestones-undo · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: milestone create / update (dialog), date move (marker drag), and delete all push undo+redo entries with live local-state patching.
Done looks like: create → Ctrl+Z deletes it → Ctrl+Shift+Z recreates (new id, history entry follows the live row via mutable id binding); edit → undo restores all prior fields; marker drag → undo restores date; delete → undo recreates the milestone with identical fields.
Must not change: dialog dirty-confirm flow (Save changes? / Discard); marker click-vs-drag threshold; popover behavior; existing onSaved/onDeleted/onChanged contracts (new props are additive + optional).
ID-rebirth handling: create-undo→redo and delete-undo→redo recreate rows with new ids; each entry holds `currentId` mutable state so undo/redo cycles always target the live row.

Risk tier: 2 · Blast radius: milestone CRUD on roadmap + timeline shared-axis consumers of stored milestones.
Write-set: milestone-dialog.tsx, milestone-markers.tsx, roadmap-view.tsx (props wiring).
Verification: tsc/eslint clean; unit+roadmap suites — only the 2 pre-existing failures. Real-browser in D1.
Rollback: git revert unit commit.
Commit name: feat(roadmap): undo/redo for milestone create, edit, move, delete
