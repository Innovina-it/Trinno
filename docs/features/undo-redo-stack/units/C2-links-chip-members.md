# Unit C2 — card link chip, members, dependency-links finding

Unit: C2-links-chip-members · Owner: ali (lane self) · Date: 2026-06-11 · Status: BUILT (autonomous run)

Goal: roadmap-surface link-chip edit/remove and member toggles push undo+redo entries; deliverable view confirmed riding the same components; dependency-link reality documented.
Done looks like: edit chip URL/color on the Gantt bar or list/deliverable row → undo restores prior URL+color; remove chip → undo recreates it (upsert keyed by cardId, fresh row id handled); assignee toggle in roadmap quick view → undo toggles back, redo re-applies.
Recon finding (closes recon's open point): dependency links (blocks / is_blocked_by) have NO roadmap-native mutation surface — dependency-arrows.tsx is render-only; create/delete happens only in the card modal's links section (card-links-section.tsx:195/217), which is already undo-wired and gains redo in E1. Chip CREATION likewise lives in the card modal only (roadmap dialogs open only on existing chips). Deliverable view = roadmap-list-view components (RowLinkIcon, open/done select) → rides the same actions; confirmed by code path, no separate wiring needed.
Must not change: LinkEditDialog contract; store patch helpers (setCardLink/removeCardLinkLocal); toggleCardMember optimistic patterns; row click-vs-chip propagation guards.

Risk tier: 2 · Blast radius: link chip + assignees across roadmap views.
Write-set: roadmap-bar.tsx, roadmap-list-view.tsx, roadmap-view.tsx.
Verification: tsc/eslint clean; unit+roadmap suites — only the 2 pre-existing failures. Real-browser in D1.
Rollback: git revert unit commit.
Commit name: feat(roadmap): undo/redo for link chip edits and assignee toggles
