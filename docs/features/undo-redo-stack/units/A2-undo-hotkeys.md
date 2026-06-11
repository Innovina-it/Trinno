# Unit A2 — global undo/redo hotkeys

Unit: A2-undo-hotkeys · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes, app-wide, with toast feedback; never while typing.
Done looks like: hotkeys walk the stacks from any authed page; toast "Undid/Redid: <message>"; typing targets get native text undo; rapid presses serialize (promise queue, no overlapping server actions); shortcuts overlay lists both.
Must not change: roadmap plain `z` zoom (modifier required), Cmd/Ctrl+K palette, card-modal `[`/`]`/`c`, ShortcutsOverlay `?`, banner behavior.

Risk tier: 2 · Blast radius: global keydown surface on all authed pages.
Read-set: use-nav-chords.ts, shortcut-guard.ts, shortcuts-overlay.tsx · Write-set: lib/undo-hotkeys.ts (new), components/undo-hotkeys.tsx (new), app/(app)/layout.tsx (+2 lines), components/shortcuts-overlay.tsx (+2 rows), tests/unit/undo-hotkeys-classify.test.ts (new)
Parallel-safe with: nothing dispatched concurrently (sequential run).

Verification: classifier unit tests (jsdom) 6/6; tsc + eslint clean; real-browser pass consolidated into D1 (declared gap).
Rollback: git revert of unit commit.
Commit name: feat(undo): global Cmd/Ctrl+Z / Shift+Z hotkeys with focus guard
