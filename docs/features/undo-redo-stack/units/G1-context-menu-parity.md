# Unit G1 — context-menu undo parity

Unit: G1-context-menu-parity · Owner: ali (lane self) · Date: 2026-06-12 · Status: BUILT (user-reported gap, approved at combined Gate 0+1)

Gap (found by Ali in UAT): every mutation fired from the right-click context menu bypassed the undo bus — Ctrl+Z blind to: set/clear priority, archive, toggle complete (both surfaces) and the roadmap Edit-dates dialog Save.
Goal: the 7 context-menu handlers push undo+redo entries with the same optimistic/rollback/toast pattern as the rest of the feature.
Sites wired:
  - roadmap-bar.tsx: handleArchive, handleToggleComplete (setRoadmapCompletion), handleSetPriority, handleSaveDates (Edit-dates dialog)
  - card-tile.tsx: menuArchive, menuToggleComplete, menuSetPriority
Must not change: CardContextMenu component untouched (handlers live in consumers); menu keyboard parity; existing success/error toasts.

Risk tier: 2 · Write-set: roadmap-bar.tsx, card-tile.tsx, undo-redo-stack.spec.ts (live assertion added).
Verification: tsc/eslint clean; tests/unit+roadmap 455/455; LIVE e2e — bar-drag test extended with right-click → Priority High → banner shows entry → Ctrl+Z "Undid: Priority High" → Ctrl+Shift+Z "Redid" (3/3 green). Archive/complete paths share the verified pattern.
Rollback: git revert unit commit.
Commit name: feat(undo): context-menu actions push undo/redo entries
