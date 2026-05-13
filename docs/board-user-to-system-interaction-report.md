# Board User-to-System Interaction Report

## Scope

Created a product interaction diagram for the board page only. It intentionally avoids code architecture and instead shows how a user acts and how the UI/system guides, validates, confirms, and recovers.

Output file:

- `docs/board-user-to-system-interaction.svg`

## Evidence From The Code

- Board-level focus controls live in `components/board/board-view.tsx`. The board parses filters from the URL, applies them to visible cards, partitions swimlanes, shows presence, and wires the sprint/activity toggles. Relevant evidence: `components/board/board-view.tsx:131`, `components/board/board-view.tsx:144`, `components/board/board-view.tsx:150`, `components/board/board-view.tsx:160`, `components/board/board-view.tsx:407`.

- Filter guidance comes from `components/board/board-filter-bar.tsx` and `lib/board-filters.ts`. The UI shows active filter count, assigned-to-me, due, scheduled, label/type filters, hide completed, and clear-all. Filters serialize into query params such as `assignee=me`, `scheduled=1`, and `done=hide`. Relevant evidence: `components/board/board-filter-bar.tsx:51`, `components/board/board-filter-bar.tsx:59`, `components/board/board-filter-bar.tsx:107`, `components/board/board-filter-bar.tsx:147`, `lib/board-filters.ts:24`, `lib/board-filters.ts:47`, `lib/board-filters.ts:90`.

- Empty and recovery states are explicit in `components/board/board-view.tsx`. If filters hide everything, the user sees a hidden-by-filters message and a clear action. If the board has no lists, the user sees an empty board state with add-list guidance. Relevant evidence: `components/board/board-view.tsx:472`, `components/board/board-view.tsx:483`, `components/board/board-view.tsx:508`, `components/board/board-view.tsx:513`.

- Drag guidance and movement recovery are handled in `components/board/board-view.tsx`, `components/board/list-column.tsx`, and `components/board/sprint-drop-strip.tsx`. The board uses an 8px activation threshold, drag overlay, list/sprint droppable targets, optimistic local movement, server save, undo for cross-list moves, error toast, retry bus, and refresh on failure. Relevant evidence: `components/board/board-view.tsx:171`, `components/board/board-view.tsx:182`, `components/board/board-view.tsx:221`, `components/board/board-view.tsx:250`, `components/board/board-view.tsx:338`, `components/board/board-view.tsx:357`, `components/board/board-view.tsx:376`, `components/board/list-column.tsx:104`, `components/board/sprint-drop-strip.tsx:36`.

- Card tile interactions are in `components/board/card-tile.tsx`. The tile supports selection handle, Ctrl/Cmd select, Shift range selection, double-click title editing, inline title validation, optimistic title update, complete toggle, schedule shortcut, and metadata chips. Relevant evidence: `components/board/card-tile.tsx:64`, `components/board/card-tile.tsx:90`, `components/board/card-tile.tsx:153`, `components/board/card-tile.tsx:237`, `components/board/card-tile.tsx:260`, `components/board/card-tile.tsx:377`.

- Bulk actions are in `components/board/bulk-action-bar.tsx`. The bar renders only when selected ids exist, Esc clears selection, actions are capped by `BULK_LIMIT = 50`, and actions provide success toasts, optimistic updates, undo where appropriate, rollback, and error messages. Relevant evidence: `components/board/bulk-action-bar.tsx:52`, `components/board/bulk-action-bar.tsx:54`, `components/board/bulk-action-bar.tsx:75`, `components/board/bulk-action-bar.tsx:99`, `components/board/bulk-action-bar.tsx:110`, `components/board/bulk-action-bar.tsx:125`, `components/board/bulk-action-bar.tsx:151`, `components/board/bulk-action-bar.tsx:162`, `components/board/bulk-action-bar.tsx:212`, `components/board/bulk-action-bar.tsx:291`, `components/board/bulk-action-bar.tsx:415`.

- Card modal guidance is in `components/board/card-modal.tsx`. The modal handles keyboard navigation, archive with undo, title validation, title/description autosave, save indicator, complete toggle, grouped accordion sections, notes empty state, and removed-by-other-user notice. Relevant evidence: `components/board/card-modal.tsx:204`, `components/board/card-modal.tsx:230`, `components/board/card-modal.tsx:255`, `components/board/card-modal.tsx:300`, `components/board/card-modal.tsx:361`, `components/board/card-modal.tsx:380`, `components/board/card-modal.tsx:564`, `components/board/card-modal.tsx:610`.

- Undo and persistent error recovery are global user-facing mechanisms. `components/undo-banner.tsx` displays the undo banner, `lib/undo-bus.ts` retains the most recent undo entry for about 8 seconds, and `lib/errors/error-bus.ts` stores retryable errors. Relevant evidence: `components/undo-banner.tsx:7`, `components/undo-banner.tsx:19`, `components/undo-banner.tsx:25`, `lib/undo-bus.ts:4`, `lib/undo-bus.ts:29`, `lib/errors/error-bus.ts:4`, `lib/errors/error-bus.ts:40`.

- Server-side validation and permission checks support the UI promises. Card actions parse Zod inputs and run through `dbAsUser`, while bulk actions are bounded. Relevant evidence: `actions/cards.ts:23`, `actions/cards.ts:32`, `actions/cards.ts:64`, `actions/cards.ts:138`, `actions/cards.ts:329`, `actions/cards.ts:416`, `actions/cards.ts:511`, `actions/cards.ts:527`, `actions/cards.ts:544`, `actions/cards.ts:563`, `actions/cards.ts:583`.

## Diagram Design Choices

- Used a flow matrix with five user goals: focus the board, create/edit work, move/schedule cards, bulk select/apply actions, and open card details.
- Kept each row interaction-focused: user action -> UI guidance -> local response -> validation/save -> feedback/recovery.
- Added a right-side rules panel to make product behavior explicit: visible scope, empty states, drag confidence, optimistic response, validation, undo/retry, bulk action clarity, organized modal details, and realtime removal notice.
- Used color categories consistently: blue for user action, cyan for UI guidance, green for local response, purple for validation/save, orange/red for feedback and recovery.

## Notes

- The diagram describes observed current behavior in the board page code. It does not propose new behavior.
- I did not edit implementation files.
