# Unit A1 — optimisticWrite helper + 2 wait-first stragglers

Unit: A1-optimistic-write-helper · Owner: ali (lane self) · Date: 2026-06-12 · Status: DRAFT awaiting Gate 1

Goal: one shared `optimisticWrite` helper (lib/optimistic-write.ts) expressing the canonical pattern — apply local → server write in background → rollback+toast+rethrow on failure → undoBus entry with symmetric redo. Migrate the two remaining wait-first sites onto it.

Done looks like:
  - editing the time estimate updates the field INSTANTLY (today it waits for the server)
  - changing the card type updates the chip instantly, AND gains rollback on error + Ctrl+Z/Ctrl+Shift+Z (today: lag, no rollback, no undo)
  - new unit tests prove: local apply happens before the server resolves; failed write reverts and rethrows; success pushes an undo entry whose redo re-applies; failed undo is not redoable (A1 bus contract)
  - helper is the documented seed for future sites (JSDoc with usage)

Must not change:
  - the 23 already-optimistic sites — untouched this unit (adopt on touch)
  - undo bus semantics (push API, entry shape, swallow-at-bus + rethrow-at-site contract)
  - time-section worklog flow and type-picker legacy-type rendering
  - success toast "Type set to <x>" stays (call-site concern, not helper's)

Risk tier: 2 · Blast radius: helper consumed app-wide over time; this unit wires only 2 sites.
Write-set: lib/optimistic-write.ts (new), components/board/card/time-section.tsx, components/board/card/type-picker.tsx, tests/unit/optimistic-write.test.ts (new).
Verification: tsc/eslint; new unit tests + full unit suite; real-browser check of both fields (instant update, undo, redo, error toast via offline sim optional).
Rollback: git revert unit commit.
Commit name: feat(feedback): shared optimisticWrite helper + estimate/type instant edits
