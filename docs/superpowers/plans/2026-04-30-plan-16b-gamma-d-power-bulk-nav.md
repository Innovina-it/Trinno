# Plan #16b-γ-D — Power + Bulk + Nav

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** 8 items. Power-user keyboard, multi-select bulk ops, undo, cross-board operations, workspace switcher search.

## Tasks

### Task 1 — Cmd+K command palette (#5)

`components/cmd-palette/cmd-palette.tsx` (client) — global modal mounted in `app/(app)/layout.tsx`.
- Open: `⌘K` / `Ctrl+K` keydown anywhere.
- Close: `Esc`.
- Input → fuzzy search across:
  - Boards (label = board.title, sub = workspace name)
  - Workspaces
  - Cards (top 20 from current workspace store if available; otherwise no-op)
  - Static actions: New board · New card · New workspace · Toggle theme · Sign out
- Selecting navigates / dispatches.
- Use existing `searchCards` server action from plan #6 for card results (debounced 200ms).

`hooks/use-shortcut.ts` (client) — small hook `useShortcut("mod+k", () => setOpen(true))`. Avoid extra deps; bind document keydown.

Tests: unit test for fuzzy match scoring.

Commit: `feat(palette): cmd+k global palette with fuzzy boards/workspaces/cards/actions`.

### Task 2 — Quick-add card (#6)

Tied to palette: action "New card" prompts for board → list → title in a 3-step palette flow. Or simpler:
- `c` keyboard shortcut anywhere → opens an inline mini-modal "Quick add card": board picker (defaults to last visited), list picker, title input. Submit → `createCard` → toast "Card added · Open" with link.
- `useShortcut("c", ...)` if not in input.

Component: `components/cmd-palette/quick-add-card.tsx`. Mounts in layout alongside palette.

Commit: `feat(palette): quick-add card via "c" shortcut`.

### Task 3 — Card modal [/] tab nav (#7)

In card modal pages (`/b/{board}/c/{card}` and `@modal/(.)c/{card}`):
- Bind `[` to navigate prev card in current list.
- Bind `]` to navigate next.
- Use `useBoardStore` to find current card's list, get sibling cards sorted by position.
- Push to `/b/{board}/c/{prevId}` via `router.push`.

In `components/board/card-modal.tsx`, add `useShortcut("[", prev)` and `useShortcut("]", next)`. Disable when input/textarea focused.

Commit: `feat(card-modal): [ / ] keyboard nav between sibling cards`.

### Task 4 — Multi-select + bulk (#8)

In `components/board/card-tile.tsx`:
- Hold Shift+click → range-select.
- Hold Cmd/Ctrl+click → toggle.
- Plain click → modal nav (existing).

State stored in `useBoardStore` (new field `selectedCardIds: Set<string>` + mutators `toggleSelected`, `selectRange`, `clearSelection`).

When `selectedCardIds.size > 0`: render a fixed bulk-action bar at bottom of board view. Actions: Assign · Label · Move list · Set sprint · Set component · Archive · Cancel.

Each bulk action calls existing single-card actions in parallel via `Promise.all`. Cap at 50 cards per batch.

Commit: `feat(board): multi-select cards + bulk action bar`.

### Task 5 — Undo banner (#10)

`components/undo-banner.tsx` (client) mounted in `app/(app)/layout.tsx`.

`lib/undo/undo-bus.ts`:
```ts
export type UndoEntry = { id: string; label: string; undo: () => Promise<void> | void; ts: number };
class UndoBus {
  push(entry: Omit<UndoEntry, "id" | "ts">): void;
  on(listener: (entry: UndoEntry | null) => void): () => void;
}
export const undoBus = new UndoBus();
```

Push undo entries from common actions:
- `moveCard` (pre-move card had `prev list+pos`; undo restores).
- `archiveCard` (undo: archive=false).
- Bulk actions (undo: revert each).

Banner shows "Moved 3 cards · Undo" with 8s timer; click Undo → call entry.undo() → clear.

Commit: `feat(undo): toast-style undo bus + banner with 8s timer wired into move/archive/bulk`.

### Task 6 — Cross-board move (#37)

Modify `actions/cards.ts`:
- New action `moveCardToBoardImpl(token, { cardId, targetBoardId, targetListId, position })`.
- Validates user has board membership of TARGET board (RLS handles read; need write check via dbAsUser).
- Updates `cards.list_id`, `cards.board_id` (denorm), `cards.position`.
- Triggers re-cascade `set_card_board_id` for child rows (subtasks, comments, attachments, links — all denormalize board_id via existing triggers; if not, this is the gap to address).

UI: in card-modal toolbar, add "Move to…" button (icon: `Move`). Opens picker dialog: board search → list dropdown → confirm.

Validation: `MoveCardToBoardInput`.

Test: `tests/integration/move-card-cross-board.test.ts` (3 tests: happy path, reject when user not target-board admin, child rows board_id update).

Commit: `feat(cards): cross-board move action + dialog`.

### Task 7 — Cross-board card linking (#38)

Currently `card_links` are board-scoped (RLS reads only same-board). Extend:
- Modify `card_links_select` policy: allow read if user is member of EITHER from-card's board OR to-card's board.
- Modify CardLinksSection link picker to show suggestions across all the user's accessible boards (use a new server action `searchCardsForLink` that fuzzy-matches across workspace).
- When rendering an external linked card, show its board name as sub-label and a "↗" external icon.

Migration `0044_card_links_cross_board.sql` updates the RLS policy. Test: cross-board link creation + read.

Commit: `feat(card-links): cross-board linking with widened RLS read`.

### Task 8 — Workspace switcher search (#39)

Modify `components/nav/workspace-switcher.tsx`:
- Inside dropdown, top item is search input.
- Type → filter list of workspaces by `name.toLowerCase().includes(q.toLowerCase())`.
- Fall back to recent-active sort (use `recent_views` if available; else by `updated_at`).

Commit: `feat(nav): workspace switcher search input`.

### Task 9 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm run test:unit` ~143+ expected (139 + ~4 new tests across palette/move-cross-board).
- `npx playwright test` 10 still green.

## Constraints

- No new deps. Inline fuzzy match: simple substring + position scoring.
- Keyboard shortcuts disabled when typing in input/textarea (use `event.target` check).
- Multi-select state lives in store; clears on board navigation.
- Undo entries are in-memory only (lost on refresh).
- Cross-board move requires user to be member of BOTH boards.

## Self-Review Notes

- **Fuzzy matching**: simple `score = -indexOf` + length penalty. Anything more requires fuse.js (deferred).
- **Cmd+K must work** even when palette mounted but page is mid-route-transition. Mount at root layout.
- **Bulk action bar** appears when `selectedCardIds.size > 0`, slides up from bottom. z-index above board.
- **Undo bus** is in-memory only — no DB persistence. By design.
- **Cross-board links**: SELECT side widens; INSERT still requires board admin of FROM board.
- **Workspace switcher search** auto-focuses input when dropdown opens.
