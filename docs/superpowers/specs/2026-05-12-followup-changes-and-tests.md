# Today's Follow-up Changes and How to Test Them

**Date**: 2026-05-12
**Branch**: plan/01-foundation
**Scope**: changes made AFTER the main 24-task triage commit `dfb9e69`.

If you already tested the main triage from `2026-05-12-changes-and-test-plan.md`, this document covers what was added or fixed on top of it.

## Pre-flight

```bash
git checkout plan/01-foundation
npm install
supabase migration up   # if you haven't yet — applies 0095_milestones
npm run dev
```

Open the app in a browser, sign in, pick the AIWEPI workspace.

---

## 1. Quick Card View popup (double-click on board, single-click on roadmap)

### What changed
Instead of always opening the full-page card modal, there is now a "quick view" popup with a compact summary that surfaces:

- Title (editable)
- Type pills (TASK / STORY / BUG / SUB-BOARD) — editable, click to switch
- Priority + Status row — editable
- Start / Target dates — editable
- Due date — editable
- Assignees — toggleable chips of every workspace/board member
- Description — editable textarea
- Subtask count (read-only)
- Buttons: **Close** and **Open advanced settings**

The "Open advanced settings" button routes to the full card modal so deeper features (comments, attachments, activity, history) are still one click away.

### How to test it

**From the board**:
1. Open any board.
2. Double-click a card body (not the title itself).
3. **Expected**: a popup opens with the summary fields. Pressing Escape or clicking Close dismisses it.
4. Click "Open advanced settings".
5. **Expected**: full card modal opens (same intercept popup as a single click on the tile).

**From the roadmap**:
1. Open the workspace roadmap.
2. Click any card bar on the gantt.
3. **Expected**: the quick view popup opens in place. The page does NOT navigate away.
4. Click "Open advanced settings".
5. **Expected**: full card modal opens (full page since roadmap and board live under different parent layouts).

---

## 2. Inline editing inside the quick view

### What changed
Every field in the quick view is editable. No need to open advanced settings for routine edits.

### How to test it

Open a quick view as in step 1 above, then try each field:

**Title**
1. Click the title text.
2. **Expected**: it becomes an input with the current title selected.
3. Type a new title. Press Enter (or click outside).
4. **Expected**: title updates, popup stays open. Re-open the popup → new title is shown.
5. Try Escape during edit → cancels and reverts.

**Type**
1. Click any of the 4 pills (TASK / STORY / BUG / SUB-BOARD).
2. **Expected**: the clicked pill becomes active. Refreshing or re-opening the card shows the new type.
3. Open the full modal → the type matches.

**Priority**
1. Click the PRIORITY cell.
2. **Expected**: a native select dropdown appears with options "— None / P0 / P1 / P2 / P3 / P4".
3. Pick a different priority.
4. **Expected**: the chip updates immediately.

**Status (DONE / OPEN)**
1. Click the STATUS cell.
2. **Expected**: toggles between OPEN ↔ DONE. The lime dot appears when done.
3. On the board behind, the card's complete state should reflect the change (strike-through or complete indicator).

**Start / Target / Due**
1. Click any of the three date inputs.
2. **Expected**: browser date picker opens.
3. Pick a new date.
4. **Expected**: the cell updates immediately and the change persists across refresh.
5. Clear the field (in the picker) → value becomes empty (saves as null).

**Assignees**
1. Click an unselected member chip.
2. **Expected**: chip becomes filled / outlined as "selected".
3. Click a selected member chip.
4. **Expected**: chip becomes unselected.
5. Open the full modal → the Members section matches what you toggled.

**Description**
1. Click into the description textarea.
2. Type something. Click outside (blur).
3. **Expected**: description saves. Re-open quick view → new description is shown.

### Notes
- Saves are **optimistic**: the UI updates immediately and a server call happens in the background. If the server rejects, you'll see a toast error. The UI doesn't roll back; the next data sync will correct any drift.
- The quick view from the **roadmap** uses workspace-wide profiles (no avatar URLs). The quick view from the **board** uses board-scoped profiles (with avatars if set).

---

## 3. Roadmap "new card" dialog now has assignees

### What changed
When you create a card from the gantt (drag-paint or `n` shortcut), the dialog now includes an ASSIGNEES section with toggleable member chips, matching the same UX as the board's inline "+ Add card" form.

### How to test it
1. Open the roadmap.
2. Press `n` (or drag-paint a date range on the canvas).
3. **Expected**: dialog opens with title, type pills, board/list selects, start/target dates, AND an ASSIGNEES chip row below the dates.
4. Pick 1-3 members.
5. Submit ("Create card").
6. Open the created card from the roadmap (quick view) or from the board (full modal).
7. **Expected**: assignees are exactly the people you picked.

### Edge case
- Creating without picking any assignee: the card is created and **also** automatically assigns YOU as owner (per Task 10 from the main triage). Verify by opening the new card: you should be the owner, and the Members list should be empty unless you picked anyone.

---

## 4. Visual fixes

### "ASSIGNEES UNASSIGNED" no longer glued
Earlier the quick view's empty-assignees state rendered as `ASSIGNEESUnassigned` with no gap. Now: label is on its own row, "Unassigned" sits below it as a separate line.

### Subtitle dropped
The "Open. Read-only summary; use advanced for edits." subtitle is gone. The STATUS chip already shows OPEN/DONE, and the "Open advanced settings" button name explains the advanced path.

### How to test
1. Open a quick view on a card that has no assignees.
2. **Expected**: ASSIGNEES label on top, "Unassigned" text beneath. No squishing.
3. **Expected**: no subtitle under the title.

---

## 5. Snapshot-loop bugs squashed

### What changed (internal)
Two infinite-loop bugs were fixed:

- **Subtask badge** on board cards: a Zustand selector was returning a new array every call, triggering React's "result of getSnapshot should be cached" warning and an infinite re-render loop. Fixed by wrapping in `useShallow`.
- **Quick view profile selectors**: same family of bug, this time inside the quick view's read of `boardProfiles` / `workspaceProfiles`. The selector built fresh `{id, displayName, avatarUrl}` objects inside `useShallow`, which compares items by reference. Fixed by returning the raw store array and transforming outside the selector.

### How to test it
1. Open a board with many cards.
2. Open the browser DevTools console.
3. Hover, click, open quick views, type in inputs.
4. **Expected**: no "result of getSnapshot should be cached" warnings.
5. Leave the board open for 5 minutes with sporadic activity.
6. **Expected**: app stays responsive, no React error boundary triggered.

---

## 6. Migration applied

### What changed
The `milestones` table from migration `0095_milestones.sql` is now applied to the local Supabase database. Earlier it existed in the repo but not in the running DB, causing `relation "milestones" does not exist` on every roadmap load.

### How to test it
1. Open the roadmap.
2. **Expected**: no DB error in the server console.
3. Click "Add milestone" in the toolbar (if you ran the milestones seed).
4. Create one with a name, date, color.
5. **Expected**: a vertical line appears on the gantt at that date with the milestone label at top.

If you want sample data:
```bash
node scripts/seed-aiwepi-milestones.mjs
```

---

## Verification (already done by us)

You don't need to re-run unless something looks off:

```bash
npx tsc --noEmit            # 0 errors
npm run lint                # clean
npm run test:unit           # 268/268 pass
```

---

## If something is wrong

Reference the section number and step that failed (e.g. "Section 2 → Priority → step 3"). We trace from there.
