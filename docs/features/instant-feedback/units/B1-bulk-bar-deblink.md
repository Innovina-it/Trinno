# Unit B1 — bulk-action-bar de-blink

Unit: B1-bulk-bar-deblink · Owner: ali (lane self) · Date: 2026-06-12 · Status: BUILT

Goal: bulk operations stop reloading the page; feedback comes from store patches (+ realtime CDC reconciliation), killing the post-action flash.
Changes: removed the 6 success-path router.refresh() calls that doubled already-complete optimistic patches (complete, label, assign, sprint, priority, component). Archive — the one op with NO local patch — gained it: tiles vanish instantly (store removeCard), undo re-adds the snapshotted rows and now has a symmetric redo; failure paths restore rows. onMoveToList keeps its CATCH-path refresh (partial multi-card move = honest divergence recovery).
Must not change: BULK_LIMIT guard, Esc-clears-selection, toast wording, undo entry messages, errorBus pushes, guest bail-out.
Risk tier: 2 · Write-set: components/board/bulk-action-bar.tsx only.
Verification: tsc/eslint clean; tests/unit+roadmap 459/459. Live check delegated to Ali's UAT (declared): select ≥2 cards → complete/archive → no page flash, tiles update instantly, Ctrl+Z restores (archive now also Ctrl+Shift+Z). Rationale for low risk: 6 ops were already optimistic — only the redundant refresh was removed; archive's new local logic mirrors the snapshot/re-add pattern proven in milestones (C1).
Rollback: git revert unit commit.
Commit name: feat(feedback): bulk actions patch the store instead of reloading the page
