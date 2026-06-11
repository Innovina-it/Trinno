# Unit E1 — redo on board card-field sites

Unit: E1-board-redo · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: the 16 card-field push sites supply `redo()`, so Ctrl+Shift+Z re-applies undone board field edits.
Sites wired: archive card, title, description, complete (card-modal ×1, complete-toggle, due-section toggle), members, priority, owner, parent, story points, roadmap dates, estimate, due date, cover, labels, card links (add + remove, mutable-id rebirth handling), component toggle.
Also hardened: every touched undo body now rethrows after its rollback+toast, so a FAILED undo is never moved to the redo stack (A1 contract); previously failures were silently swallowed and the bus would have mis-filed them.
Stays undo-only (per approved scope): comments, attachments, checklists, sub-tasks, bulk actions, inbox, archive list, move-card-between-lists.
Must not change: every site's optimistic-patch + rollback + toast pattern (redo mirrors it); push messages unchanged; subtaskSyncBus emit on complete-toggle fires only on the ORIGINAL action (not on undo/redo — matches cascade-prompt rule).

Risk tier: 2 · Blast radius: redo behavior across all board card fields.
Write-set: card-modal.tsx, labels-section.tsx, members-section.tsx, priority-picker.tsx, owner-section.tsx, parent-picker.tsx, story-points-picker.tsx, roadmap-dates-section.tsx, time-section.tsx, due-section.tsx, complete-toggle.tsx, cover-picker.tsx, card-links-section.tsx, component-card-section.tsx.
Verification: tsc clean; eslint clean on touched files (one pre-existing warning in untouched card-quick-view.tsx); tests/unit 443/443. Real-browser in D1.
Rollback: git revert unit commit.
Commit name: feat(undo): redo callbacks on 16 board card-field sites
