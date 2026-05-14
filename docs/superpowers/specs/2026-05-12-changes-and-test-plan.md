# What Changed and How to Test It

**Date**: 2026-05-12
**Commit**: dfb9e69 on branch `plan/01-foundation`
**Scope**: 24 of 25 tasks from the user triage list. Task #25 (Sprint) deferred.

## How to use this document

For each change below: read the **What changed** so you know what to look at, then run the **How to test it** steps. Each test is short. If anything doesn't behave as described, write it down and tell us which numbered test failed.

## Before you start

Open a terminal in the project directory and run:

```bash
git checkout plan/01-foundation
npm install
npm run dev
```

Then open the app in your browser at the URL the dev server prints (usually http://localhost:3000).

Sign in with your normal account. The AIWEPI workspace should be visible.

If you want fresh data:

```bash
node scripts/seed-aiwepi.mjs
node scripts/seed-aiwepi-milestones.mjs
```

---

## 1. Card click now opens a popup (Task #2)

### What changed
Before: clicking a card on a board went to a full new page.
Now: clicking a card opens a popup overlay on top of the board. Direct URL (paste a link) still opens the full page.

### How to test it
1. Open any board (e.g. AIWEPI).
2. Click any card.
3. **Expected**: a popup opens over the board, board stays visible behind.
4. Press Escape or click outside.
5. **Expected**: popup closes, you're back on the board with your scroll position kept.
6. Copy the card URL (right-click → copy link), paste in a new tab.
7. **Expected**: full page opens (this is correct fallback behavior).

### Keyboard test
1. Tab through cards on the board.
2. Press Enter on a focused card.
3. **Expected**: popup opens. Press Escape to close.

---

## 2. Browser no longer freezes after long sessions (Task #4)

### What changed
Three quiet bugs were causing memory and re-render storms after extended use:
- The app was re-downloading the entire board page on every small change.
- Every comment from the entire board was kept in browser memory forever; opening a card forced a search through all of them.
- The live-update connection kept tearing itself down and rebuilding every time anything changed.

All three are fixed.

### How to test it
1. Open a board. Make 10 quick changes in a row (move a card, change a label, add a comment, change due date, etc.).
2. Open browser DevTools → Network tab.
3. **Expected**: you should see at most 1 or 2 RSC requests for the burst, not 10.
4. Open DevTools → Performance Monitor (Chrome: Cmd/Ctrl+Shift+P → "Show Performance monitor").
5. Watch the "JS heap size" graph.
6. Spend 10 minutes adding comments and clicking through cards.
7. **Expected**: heap size grows slowly then plateaus, does not climb linearly toward 500MB.
8. After 30 minutes of use, the app should still feel responsive (no freeze, no scroll lag).

### Realtime test
1. Open the app in two tabs.
2. Move a card in tab A.
3. **Expected**: tab B updates within a second without a full page reload.
4. Rename a board in tab A.
5. **Expected**: tab B reflects the rename, and tab B's live connection does not visibly disconnect (no "reconnecting" indicator).

---

## 3. Role system documented (Task #1)

### What changed
There's now a complete reference for who can do what in the app: workspace owner/admin/member, board admin/member/observer, dashboard viewer/editor. The doc lives at `docs/roles.md`.

### How to test it
1. Open `docs/roles.md` in your editor or on GitHub.
2. Read the tables for each role tier.
3. **Expected**: every row matches what you understand the role system to be.
4. Try the "How to change a role" section steps in the app:
   - Workspace role: go to `/w/<your-workspace>/settings`, find Members section, change a member from `member` to `admin` and back.
   - Board role: open a board, open the Members panel, change a member's role.
5. **Expected**: changes save and apply immediately.

### Bonus: known gaps
The doc lists 4 security gaps at the bottom. These are documented but NOT fixed in this round. Read the "Known gaps" section so you know they're there.

---

## 4. Data cleanup: descriptions, English, real start date (Tasks #15-20)

### What changed
- Project start date is now fixed at **2025-10-15** (was: dynamic, anchored to "today").
- All Italian text in the AIWEPI seed data is now English.
- Every task and every deliverable has a description now (previously blank or missing).
- Audit confirmed no work-package and task share the same name.
- Milestones stay as a separate concept (see section 6); Versions table unchanged.

### How to test it
1. Wipe and re-seed the AIWEPI data:
   ```bash
   node scripts/seed-aiwepi.mjs
   ```
2. Open the AIWEPI roadmap.
3. **Expected**: M1 (first milestone marker) is on or near 2025-10-15.
4. Open any work package card.
5. **Expected**: title is English. Description present.
6. Open any deliverable subtask.
7. **Expected**: description present, 1-2 sentences in English.
8. Open any task (story) card.
9. **Expected**: description present.

---

## 5. Roadmap improvements (Tasks #5, #6, #8, #9, #10, #11)

### 5a. Lane names no longer get cut off (#8)

**Test**:
1. Open the roadmap view.
2. Find any lane with a long name.
3. **Expected**: the name wraps onto 2 lines instead of being cut with "...".
4. Hover the lane name.
5. **Expected**: a tooltip shows the full name.

### 5b. Roadmap is responsive to window width (#9)

**Test**:
1. Open the roadmap view.
2. Resize the browser window narrower (try 1024px, 900px, 768px).
3. **Expected**: the lane label column shrinks gracefully (between 140 and 240 pixels wide). The gantt area on the right stays scrollable.
4. **Expected**: no horizontal jank, no broken layout.

### 5c. Subtask filter doesn't hide parent tasks (#11)

**Test**:
1. Open the roadmap view.
2. In the filter bar, toggle "Hide subtasks" (or whatever the subtask filter is called).
3. **Expected**: subtasks disappear from under parent tasks, but the parent tasks themselves are STILL visible.
4. Toggle the subtask filter off again.
5. **Expected**: subtasks reappear under their parents.

### 5d. New card form and edit card form are consistent (#5)

**Test**:
1. On a board, click "+ Add card" on any list.
2. **Expected**: form has fields for title, assignee (members), due date.
3. Type a title, pick an assignee, pick a due date, save.
4. Click the card you just created to open the edit popup.
5. **Expected**: at the top of the popup, you can see and quickly edit the title, assignee, and due date without scrolling.

### 5e. New card on the gantt has an owner and lands in todo (#10)

**Test**:
1. Open the roadmap view.
2. Drag-paint or right-click on the gantt canvas to create a new card.
3. Fill in the form and save.
4. Open the card.
5. **Expected**: the owner is set to YOU (the current user).
6. Go to the board.
7. **Expected**: the new card appears in the first "todo" list (not floating without a list).

### 5f. New list view of the roadmap (#6)

**Test**:
1. Open the roadmap view.
2. Look for a toggle in the toolbar: "Gantt | List".
3. Click "List".
4. **Expected**: a hierarchical list view appears — sub-boards at the top, tasks nested under their sub-board, subtasks nested under their task.
5. **Expected**: rows are sorted by start date, earliest first. Items with no start date appear at the bottom.
6. **Expected**: each row shows a priority dot, the title, the dates, an owner avatar, and the completion state.
7. Click "Gantt" to switch back.

---

## 6. Milestones on the roadmap (Task #17 — redefined)

### What changed
Milestones are now a real concept in the app, separate from Versions. They appear as vertical lines across the gantt canvas at a specific date. Workspace admins can create, edit, and delete them.

### How to test it
1. Open the roadmap view.
2. **Expected**: there is an "Add milestone" button somewhere in the toolbar.
3. Click "Add milestone".
4. Fill in a name (e.g. "Demo Day"), a date, an optional color, save.
5. **Expected**: a vertical line appears on the gantt at that date, with the name shown at the top.
6. Click the milestone label.
7. **Expected**: a small popover shows the name, date, description, and edit/delete buttons.
8. Edit the date.
9. **Expected**: the line moves to the new date.
10. Delete it.
11. **Expected**: the line disappears.

### Filter
1. With one or more milestones visible, find the "Hide milestones" toggle in the filter bar.
2. Toggle on.
3. **Expected**: all milestone lines disappear from the canvas.
4. Toggle off.
5. **Expected**: lines come back.

### Seed
```bash
node scripts/seed-aiwepi-milestones.mjs
```
Creates 5 milestones in the AIWEPI workspace at M1-M5 dates. Re-running is safe (idempotent).

---

## 7. Filter system: All / Mine / Unassigned (Tasks #3, #21, #23)

### What changed
There's now a 3-option control on the Board, Roadmap, and All Tasks views:
- **All** = show everything
- **Mine** = show only cards assigned to me
- **Unassigned** = show only cards with nobody assigned

The three options are mutually exclusive (picking one clears the others).

### How to test it
1. Open a board.
2. Find the filter bar at the top.
3. **Expected**: a 3-option segmented control labeled All / Mine / Unassigned.
4. Click "Mine".
5. **Expected**: only cards where you're an assignee or owner are visible.
6. Look at the URL.
7. **Expected**: URL ends with `?assignee=me` (or similar).
8. Click "Unassigned".
9. **Expected**: only cards with no assignees and no owner are visible. URL becomes `?assignee=none`.
10. Click "All". URL clears the parameter.
11. Refresh the page with `?assignee=me` in the URL.
12. **Expected**: the filter is still active.

Repeat the test on the Roadmap view and the All Tasks page (`/w/<workspace>/all-tasks`).

---

## 8. Cross-workspace timeline (Task #22)

### What changed
There's a new page at `/me/timeline` that shows YOUR cards across ALL workspaces in a single gantt view, grouped by workspace then by board.

### How to test it
1. Make sure you're a member of at least 2 workspaces and have some cards with start/target dates in each.
2. Go to `/me`.
3. **Expected**: there's a header explaining the page is "your view across all workspaces" and a link "My timeline →".
4. Click the link.
5. **Expected**: you land on `/me/timeline` and see a gantt view with cards from multiple workspaces, grouped by workspace name then board name.
6. **Expected**: there's a workspace multi-select filter at the top.
7. Use the filter to deselect a workspace.
8. **Expected**: that workspace's section disappears from the timeline.

---

## 9. My Tasks page kept (Task #13)

### What changed
Nothing. You said keep it, so it stays exactly as it was. A one-line comment in the file notes the decision so future maintainers know.

### How to test it
1. Open `/me`.
2. **Expected**: the page still works as before, showing cards assigned to you across all workspaces.

---

## 10. Workspace creation with member selection (Task #7)

### What changed
When you create a new workspace, you can now invite members in the same dialog. The creator is added as owner; selected users are added as members in the same transaction.

### How to test it
1. Go to your workspaces page or click "New workspace".
2. In the creation dialog:
   - Type a workspace name.
   - **Expected**: there's a member search box below the name. Type a person's display name or handle.
   - **Expected**: matching profiles appear in a dropdown (limited to 12).
   - Pick a person. **Expected**: they appear as a chip below the search box.
   - Pick 2-3 more.
3. Click Create.
4. Open the new workspace's Members page.
5. **Expected**: you're the owner. The 3 people you picked are members.

### Edge case
- Creating a workspace with NO members still works (only the creator becomes owner).
- Adding yourself as a member (already creator) doesn't double-insert.

---

## 11. Sub-board boards on the boards page (Task #14)

### What changed
On the boards listing page (`/w/<workspace>/boards`), in addition to regular boards, you now see sub-board-type cards from the workspace. Sub-board tiles look the same as board tiles but have an "SUB-BOARD BOARD" tag in the corner.

### How to test it
1. Go to `/w/<your-workspace>/boards`.
2. **Expected**: regular boards appear as usual.
3. **Expected**: any sub-board-type cards in this workspace also appear as tiles in the grid, each with an "SUB-BOARD BOARD" tag overlay.
4. Click an sub-board tile.
5. **Expected**: it opens the card popup for that sub-board (same intercept popup as clicking a card on a board).

### How to verify with seeded data
After running the AIWEPI seed, you should see 6 work packages (WP1.1-WP1.6) as sub-boards. They should all show on the boards page with the SUB-BOARD BOARD tag.

---

## 12. Subtask badge on board cards (Task #24)

### What changed
On board cards that have subtasks, a small badge now shows the completion ratio (e.g. "2/5" = 2 of 5 subtasks done).

### How to test it
1. Open a board with cards that have subtasks (AIWEPI tasks have subtasks).
2. **Expected**: any card with subtasks shows a small badge in the bottom-right corner, like "0/3" or "1/5".
3. **Expected**: cards without subtasks have NO badge.
4. Hover the badge.
5. **Expected**: a tooltip appears showing up to 5 subtask titles, plus "+ N more" if there are over 5.

---

## 13. Session lifetime (Task #12)

### What changed
The code already uses the correct Supabase auth pattern (`getUser` not `getSession`), so there's nothing to fix in the code itself. The actual session expiry length is set in the Supabase dashboard, not in the app code.

### How to test it
1. Read `docs/session-config.md`.
2. The doc tells you where to go in the Supabase dashboard (Settings → Auth → JWT expiry) and recommends 8 hours.
3. To test the recommended setting: bump JWT expiry to 28800 seconds (8h) in Supabase, leave a tab idle for 4 hours, come back.
4. **Expected**: you're not logged out, no re-login prompt.

---

## 14. AIWEPI start date = 2025-10-15 (Task #19)

### How to test it
1. Re-seed:
   ```bash
   node scripts/seed-aiwepi.mjs
   ```
2. Open the AIWEPI roadmap.
3. **Expected**: M1 milestone (or the earliest cards) sit on or near 2025-10-15.
4. Open any work package.
5. **Expected**: its start/target dates are offsets from 2025-10-15, not from today.

---

## Automated verification (already done by us)

You don't need to re-run these unless something looks off:

```bash
# TypeScript: no errors
npx tsc --noEmit

# Lint: clean
npm run lint

# Unit tests: 268/268 pass
npm run test:unit
```

---

## What's NOT in this round

- **Task #25 (Sprint)**: you said TBD, so it stays as-is.
- **Role security gaps (G1-G4)**: we documented them in `docs/roles.md`. Privilege escalation paths in the role-change actions. Fix in a separate security-hardening phase if you want.
- **End-to-end Playwright tests**: not run. Would require a live database.

---

## If something is wrong

Tell us which numbered test failed (e.g. "5c step 3"). We trace it from there.
