# Remove `epic` Card Type — Full Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the deprecated `epic` card type from the entire codebase — DB enum, triggers, validation, server actions, queries, UI pickers/filters/lanes, dashboard gadgets, seeders, and tests — so that work-package containment is expressed *only* via sub-boards (`boards.parent_board_id` from migration 0099 + `boards.parent_card_id` from migration 0105).

**Architecture:** Epic-as-card was already half-deprecated: Sheet1 1b removed it from creation UX, migration 0100 cloned every `type='epic'` card into a sub-board while leaving the original epic card stranded on the parent board, and `actions/cards.ts` rejects flipping to epic at runtime. This plan completes the kill: backfill `boards.parent_card_id` from the migration-history column so each surviving anchor card is properly linked to its sub-board, demote remaining `type='epic'` rows to `'story'`, drop the enum value + triggers + check constraint allowance, then sweep every code/UI/test reference. The roadmap's `groupByEpic` is replaced by `groupBySubBoard` (lane = sub-board; header = the anchor card it's attached to via `boards.parent_card_id`).

**Tech Stack:** PostgreSQL via Supabase migrations, Drizzle ORM schema (`lib/db/schema.ts`), Zod validation, Next.js App Router (server actions in `actions/`, server components in `app/`), Zustand client store (`stores/board-store.ts`), Vitest unit/integration tests, Playwright e2e.

---

## File Structure

### Backend / DB
- Create: `supabase/migrations/0106_drop_epic_type.sql` — backfill `boards.parent_card_id`, demote remaining `epic` cards to `story`, drop epic triggers/functions, redefine `cards.type` check without `'epic'`, drop the now-unused migration audit tables.
- Modify: `lib/db/schema.ts` — drop `migratedFromEpicId` column declaration (column is dropped in 0106).
- Modify: `lib/validation.ts` — drop `"epic"` from `CardType` enum; rewrite "parent epic" comment.
- Modify: `lib/rules/types.ts` — drop `"epic"` from `set_type` rule action union.
- Modify: `actions/cards.ts` — drop the `parsed.type === "epic"` rejection branch and its inline type annotation.

### Queries
- Modify: `lib/queries/workspaces.ts` — delete `EpicTile` type and `listEpicsInWorkspace` function.

### Roadmap layout (replacement of `groupByEpic`)
- Modify: `lib/roadmap/layout.ts` — replace `groupByEpic` with `groupBySubBoard`. New signature takes the cards list **plus** a `subBoards: { id, title, parentCardId }[]` list (sub-boards visible to the viewer). Lane = sub-board; `headerCard` = the card whose `id === sub.parentCardId` (looked up in the input cards list); lane.cards = cards whose `boardId === sub.id`. Top-level cards on the parent board that don't have a sub-board attached fall into per-card orphan lanes, same as today. Update `Lane.kind` literal to `"sub_board" | "uncategorized" | "assignee" | "component"` (drop `"epic"`). Subtask sub-row stacking unchanged.
- Modify: `components/roadmap/roadmap-view.tsx` — call `groupBySubBoard(cards, subBoards)`; URL lane mode `"epic"` → `"sub_board"`; rename `epicHeader` → `laneHeaderCard`; drop the "Mark a card as Epic" empty-state helper text; replace the `data-testid="lane-epic-header-label"` test id with `data-testid="lane-header-label"`.
- Modify: `components/roadmap/roadmap-header.tsx` — `LaneMode` literal `"epic"` → `"sub_board"`; `LANE_MODES` array; the label map `epic: "By epic"` → `sub_board: "By sub-board"`.
- Modify: `components/roadmap/use-roadmap-drag-harness.ts` — rename internal `epicId` → `parentSubBoardId` (or `laneAnchorId`); rename inline variables `epic`, `epicBoardId`, `targetEpicId`; condition `laneMode === "epic"` → `laneMode === "sub_board"`; comments updated.
- Modify: `components/roadmap/roadmap-list-view.tsx` — replace "epic → child → subtask" hierarchy: depth-0 row is now any card that has a sub-board attached *or* is a top-level card; the `type === "epic"` sort key is dropped. `isEpic` rename → `isLaneAnchor` derived from `subBoardByAnchorId.has(card.id)`.
- Modify: `components/me/me-timeline-view.tsx` — same treatment as `roadmap-list-view.tsx` (this file mirrors that one).

### Filters / pickers / dashboards
- Modify: `lib/board-filters.ts` — drop `"epic"` from `TYPE_ORDER` and drop the `epic: "Epic"` label entry.
- Modify: `components/board/board-filter-bar.tsx` — drop `"epic"` from `TYPE_OPTIONS`.
- Modify: `components/roadmap/roadmap-filter-bar.tsx` — drop `"epic"` from `TYPE_OPTIONS`.
- Modify: `components/dashboard/gadgets/gadget-cards-by-type.tsx` — drop `"epic"` from `TYPE_ORDER`.

### Workspace boards page
- Modify: `app/(app)/w/[workspaceId]/boards/page.tsx` — remove the `listEpicsInWorkspace` call from `Promise.all` and the `epics` prop on `<BoardGrid>`.
- Modify: `components/workspace/board-grid.tsx` — drop the `epics` prop, `EpicTile` import, the `visibleEpics` filter, and the entire "epic tiles" `<li>` rendering block.

### Seeder
- Modify: `scripts/seeds/aiwepi.mjs` — drop the WP-overview `type='epic'` cards. Each WP overview becomes a `type='story'` card on the **parent board**, and the corresponding sub-board is linked to it via `boards.parent_card_id` set on INSERT.

### Tests
- Modify: `tests/integration/seed-demo.test.ts` — assertion `types.has("epic")` already expects `false`; keep but verify the union type comment doesn't claim `"epic"` is valid.
- Modify: `tests/integration/card-types.test.ts` — delete the "rejects the retired epic type" sub-assertion (the runtime path is gone because the Zod enum no longer accepts it; Zod produces a different error). Replace with an assertion that `CardType.safeParse("epic").success === false`.
- Modify: `tests/unit/roadmap-layout.test.ts` — rewrite the `groupByEpic` test block: rename to `groupBySubBoard`, replace `card({ type: "epic" })` setup with `subBoards` fixtures, update assertions to lane.kind === "sub_board".
- Modify: `tests/unit/subboard-migration.test.ts` — keep as a historical regression test for migration 0100's projection logic (it still operates on synthetic `type: "epic"` fixtures, which is fine because it exercises pre-migration state). No change required.
- Delete: `tests/unit/epic_migration_ui.test.ts` — this test exercised the temporary in-product migration affordance from Sheet1; once the affordance is gone from the UI flow it has nothing to assert against. Confirm contents before deleting (see Task 13).
- Modify: `tests/e2e/gantt-drag-first.spec.ts` — rename `epicBLane`, `epicLane`, `epicBBox`, `lane-epic-header-link` test-id, and the explanatory comment headers. The test still works against sub-board lanes once they're wired in.
- Modify: `tests/e2e/jira-structure.spec.ts` and `tests/e2e/jira-gantt-integration.spec.ts` — comment-only fixes (no behavior change).

---

## Pre-flight

- [ ] **Step 0a: Confirm a clean working tree on a feature branch**

Run: `git status --short && git rev-parse --abbrev-ref HEAD`
Expected: branch is NOT `main`; no unrelated unstaged changes other than the two pre-existing entries (`components/board/card-quick-view.tsx`, `scripts/seeds/aiwepi.mjs`) and the untracked PDF/error.log.

- [ ] **Step 0b: Snapshot the current epic surface**

Run: `rtk proxy grep -rEn "'epic'|\"epic\"|isEpic|type === \"epic\"" --include="*.ts" --include="*.tsx" --include="*.mjs" lib/ components/ app/ actions/ stores/ scripts/ tests/ | wc -l`
Expected: 56 (matches the pre-plan count). Used as a regression marker — after Task 14 the count must be 0.

---

## Task 1: Migration 0106 — drop epic type at the DB layer

**Files:**
- Create: `supabase/migrations/0106_drop_epic_type.sql`

- [ ] **Step 1.1: Write the migration**

Create file with the following exact contents:

```sql
-- 0106 - drop the deprecated 'epic' card type and its support objects.
--
-- Preconditions:
--   * 0099 added boards.parent_board_id (sub-boards).
--   * 0100 cloned every type='epic' card into a sibling sub-board and moved
--     its descendants into that sub-board. The original epic card stayed
--     on the parent board.
--   * 0105 added boards.parent_card_id (1:1 card->subboard anchor).
--
-- This migration finalises the deprecation:
--   1. Backfill boards.parent_card_id from boards._migrated_from_epic_id
--      so every sub-board produced by 0100 is now anchored to the surviving
--      epic-typed card (if that card still exists and the anchor slot is
--      free).
--   2. Demote any remaining type='epic' card to 'story' so the enum value
--      can be dropped without violating the check constraint.
--   3. Drop the epic-only triggers and functions installed by 0051 / 0061.
--   4. Replace the cards.type check constraint with one that no longer
--      allows 'epic'.
--   5. Drop the audit/scratch tables created by 0100 and the
--      rollback_epic_subboard_migration helper (audit lives in git
--      history; the runtime no longer needs them).
--   6. Drop boards._migrated_from_epic_id (no remaining readers).

-- 1. Backfill parent_card_id on sub-boards produced by 0100. ----------------
update public.boards b
set parent_card_id = b._migrated_from_epic_id
where b._migrated_from_epic_id is not null
  and b.parent_card_id is null
  and exists (select 1 from public.cards c where c.id = b._migrated_from_epic_id);

-- 2. Demote stragglers. -----------------------------------------------------
update public.cards
set type = 'story'
where type = 'epic';

-- 3. Drop triggers + functions tied to the epic type. ----------------------
drop trigger if exists cards_validate_epic_parent_biu on public.cards;
drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
drop trigger if exists cards_reject_epic_with_epic_children_bu on public.cards;
drop trigger if exists cards_rollup_epic_dates_aiu on public.cards;
drop trigger if exists cards_rollup_epic_dates_ad on public.cards;

drop function if exists public.cards_validate_epic_parent();
drop function if exists public.cards_co_locate_with_epic_parent();
drop function if exists public.cards_reject_epic_with_epic_children();
drop function if exists public.cards_rollup_epic_dates();

-- 4. Replace the cards.type check constraint. ------------------------------
alter table public.cards drop constraint if exists cards_type_check;
alter table public.cards
  add constraint cards_type_check
  check (type in ('story', 'task', 'subtask', 'bug'));

-- 5. Drop migration audit tables + rollback helper (no longer referenced). -
drop function if exists public.rollback_epic_subboard_migration();
drop table if exists public.epic_subboard_migration_cards;
drop table if exists public.epic_subboard_migration_lists;
drop table if exists public.epic_subboard_migrations;

-- 6. Drop the now-orphan column. -------------------------------------------
alter table public.boards drop column if exists _migrated_from_epic_id;
```

- [ ] **Step 1.2: Lint the SQL syntactically (no DB hit)**

Run: `npx --yes sql-formatter --language postgresql supabase/migrations/0106_drop_epic_type.sql > /dev/null && echo "ok"`
Expected: `ok`. If `sql-formatter` is not installed, fall back to `node -e "require('fs').readFileSync('supabase/migrations/0106_drop_epic_type.sql','utf8')" && echo ok` (parse-only sanity).

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/0106_drop_epic_type.sql
git commit -m "feat(db): 0106 drop epic type, backfill subboard parent_card_id"
```

---

## Task 2: Drop `migratedFromEpicId` from Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts:83`

- [ ] **Step 2.1: Remove the column declaration**

Edit `lib/db/schema.ts` line 83 — delete the line:

```ts
    migratedFromEpicId: uuid("_migrated_from_epic_id"),
```

- [ ] **Step 2.2: Verify nothing else references it**

Run: `rtk proxy grep -rn "migratedFromEpicId\|_migrated_from_epic_id" --include="*.ts" --include="*.tsx" .`
Expected: zero hits (the only remaining occurrence should be the migration files themselves, which are SQL and not in the grep scope).

- [ ] **Step 2.3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (any error here means a stray reader of the column — fix it before continuing).

- [ ] **Step 2.4: Commit**

```bash
git add lib/db/schema.ts
git commit -m "refactor(schema): drop migratedFromEpicId column declaration"
```

---

## Task 3: Drop `"epic"` from validation enum + fix comments

**Files:**
- Modify: `lib/validation.ts:167-174`

- [ ] **Step 3.1: Update the enum and comment**

Edit `lib/validation.ts`:

Replace lines 167-169:

```ts
  // Optional parent epic. When set, child inherits parent's dates if its
  // own are blank.
  parentCardId: Uuid.nullable().optional(),
```

with:

```ts
  // Optional parent card. When set, child inherits parent's dates if its
  // own are blank.
  parentCardId: Uuid.nullable().optional(),
```

Replace line 174:

```ts
export const CardType = z.enum(["epic", "story", "task", "subtask", "bug"]);
```

with:

```ts
export const CardType = z.enum(["story", "task", "subtask", "bug"]);
```

- [ ] **Step 3.2: Drop `"epic"` from rule action types**

Edit `lib/rules/types.ts:74` — change:

```ts
  | { kind: "set_type"; value: "epic" | "story" | "task" | "subtask" | "bug" }
```

to:

```ts
  | { kind: "set_type"; value: "story" | "task" | "subtask" | "bug" }
```

- [ ] **Step 3.3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3.4: Commit**

```bash
git add lib/validation.ts lib/rules/types.ts
git commit -m "refactor(validation): drop epic from CardType and rule actions"
```

---

## Task 4: Remove the runtime epic-rejection branch in `actions/cards.ts`

**Files:**
- Modify: `actions/cards.ts:107, 192, 218-220`

- [ ] **Step 4.1: Inspect**

Run: `rtk proxy grep -n "epic" actions/cards.ts`
Expected output lines:
```
107: // forcing the user to repick dates.
192:   type?: "epic" | "story" | "task" | "subtask" | "bug";
218:   if (parsed.type === "epic") {
219:     throw new Error("Epic cards have been migrated to sub-boards.");
220:   }
```

Line 107 is an unrelated comment that just happens to contain the substring "epic" inside the word "repick" — leave it.

- [ ] **Step 4.2: Tighten the local type annotation on line 192**

Edit `actions/cards.ts` line 192:

```ts
  type?: "epic" | "story" | "task" | "subtask" | "bug";
```

→

```ts
  type?: "story" | "task" | "subtask" | "bug";
```

- [ ] **Step 4.3: Delete the epic-rejection branch on lines 218-220**

Edit `actions/cards.ts` — delete the entire if-block:

```ts
  if (parsed.type === "epic") {
    throw new Error("Epic cards have been migrated to sub-boards.");
  }
```

(If the immediately preceding/following blank line ends up doubled, remove the duplicate.)

- [ ] **Step 4.4: Typecheck + re-grep**

Run: `npx tsc --noEmit && rtk proxy grep -n "\"epic\"\|'epic'" actions/cards.ts`
Expected: tsc clean; grep returns zero lines (the "repick" false-positive on line 107 doesn't match because the literal string `"epic"` isn't there).

- [ ] **Step 4.5: Commit**

```bash
git add actions/cards.ts
git commit -m "refactor(actions): drop epic-type rejection branch from updateCard"
```

---

## Task 5: Drop `listEpicsInWorkspace` + `EpicTile`

**Files:**
- Modify: `lib/queries/workspaces.ts:105-144`
- Modify: `app/(app)/w/[workspaceId]/boards/page.tsx:4, 20-22, 58`
- Modify: `components/workspace/board-grid.tsx` (multiple lines)

- [ ] **Step 5.1: Delete the query**

Edit `lib/queries/workspaces.ts` — remove the `EpicTile` type declaration (lines 105-110) and the entire `listEpicsInWorkspace` function (lines 112-144). Leave the trailing newline at end of file.

- [ ] **Step 5.2: Stop calling it from the boards page**

Edit `app/(app)/w/[workspaceId]/boards/page.tsx`:

Change the import on line 4 from:

```ts
import { getWorkspace, getWorkspaceRole, listBoardsInWorkspace, listEpicsInWorkspace } from "@/lib/queries/workspaces";
```

to:

```ts
import { getWorkspace, getWorkspaceRole, listBoardsInWorkspace } from "@/lib/queries/workspaces";
```

Change the `Promise.all` on lines 20-22 from:

```ts
  const [boards, epics, favoritedIds, role] = await Promise.all([
    listBoardsInWorkspace(token, workspaceId),
    listEpicsInWorkspace(token, workspaceId),
```

to:

```ts
  const [boards, favoritedIds, role] = await Promise.all([
    listBoardsInWorkspace(token, workspaceId),
```

(Verify the remaining two calls in the array — `favoritedIds` and `role` — stay in order. Don't drop them.)

Change line 58:

```tsx
      <BoardGrid boards={boards} epics={epics} favoritedIds={favoritedIds} />
```

to:

```tsx
      <BoardGrid boards={boards} favoritedIds={favoritedIds} />
```

- [ ] **Step 5.3: Strip epic rendering from BoardGrid**

Edit `components/workspace/board-grid.tsx`:

- Line 4: remove the `import type { EpicTile } from "@/lib/queries/workspaces";` line entirely.
- Line 16: drop `epics = [],` from the destructured props.
- Line 20: drop `epics?: EpicTile[];` from the props type.
- Line 24: delete `const visibleEpics = epics.filter((e) => !e.archived);`.
- Line 27: change `if (visible.length === 0 && visibleEpics.length === 0) {` to `if (visible.length === 0) {`.
- Lines 84-end-of-epic-block (around 84-110+): delete the entire `{visibleEpics.map((epic) => ( … ))}` JSX block. Read the file first to find its exact closing line — it ends just before either the closing `</ul>` or the next sibling. Stop at the `</li>` that closes the last epic tile.

- [ ] **Step 5.4: Verify**

Run: `rtk proxy grep -n "EpicTile\|listEpicsInWorkspace\|epics" lib/queries/workspaces.ts app/\(app\)/w/\[workspaceId\]/boards/page.tsx components/workspace/board-grid.tsx`
Expected: zero hits.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5.5: Commit**

```bash
git add lib/queries/workspaces.ts 'app/(app)/w/[workspaceId]/boards/page.tsx' components/workspace/board-grid.tsx
git commit -m "refactor(workspace): drop epic tiles from workspace boards page"
```

---

## Task 6: Replace `groupByEpic` with `groupBySubBoard` (layout core)

**Files:**
- Modify: `lib/roadmap/layout.ts`
- Test: `tests/unit/roadmap-layout.test.ts`

- [ ] **Step 6.1: Update the test fixtures first (TDD)**

Edit `tests/unit/roadmap-layout.test.ts`. For the block that currently exercises `groupByEpic` (the `describe("groupByEpic"…)` group around lines 21-90 — read the file first to confirm exact ranges):

- Rename the `describe` block to `groupBySubBoard`.
- The shared `card()` helper stays.
- Replace every `card({ type: "epic", … })` with `card({ type: "story", … })` (anchor card is a regular card now).
- Add a `subBoards` fixture array of shape `{ id: string; title: string; parentCardId: string }[]`. Each former-epic gets one sub-board pointing back at it; lane.cards = the children whose `boardId` equals the sub-board's id.
- Update the import to:

```ts
import { groupBySubBoard, groupByAssignee, groupByComponent } from "@/lib/roadmap/layout";
```

- Change every `groupByEpic([…])` call site to `groupBySubBoard([…cards], […subBoards])`.
- Update `lane.kind` assertions: `"epic"` → `"sub_board"` for sub-board-anchored lanes, but keep `"uncategorized"` for self-lanes that have no sub-board. (See Task 6.2 for the new lane kind contract.)
- Also update `groupByAssignee` and `groupByComponent` skip-tests (lines 144 and 230 — `"skips epics and subtasks"`): change the description to `"skips subtasks"` and drop the `epic` card from the fixture in each test (those helpers no longer need a special epic branch — only the subtask skip remains).

- [ ] **Step 6.2: Run the test, watch it fail**

Run: `npx vitest run tests/unit/roadmap-layout.test.ts`
Expected: FAIL — `groupBySubBoard is not a function`. That's the green light to refactor.

- [ ] **Step 6.3: Rewrite `lib/roadmap/layout.ts`**

The full new content of the relevant section (`groupByEpic` → `groupBySubBoard`):

```ts
export type SubBoardRef = {
  id: string;
  title: string;
  parentCardId: string | null;
};

export type Lane<C extends RoadmapCard = RoadmapCard> = {
  id: string;
  title: string;
  kind: "sub_board" | "uncategorized" | "assignee" | "component";
  /** The card the lane is anchored to (sub-board's parent_card). Null for uncategorized lanes. */
  headerCard: C | null;
  /** Children that live inside the lane's sub-board. */
  cards: C[];
  subtaskRowsByParent: Record<string, Array<PlacedCard<C>[]>>;
};

export const UNCATEGORIZED_LANE_ID = "uncategorized";

export function groupBySubBoard<C extends RoadmapCard>(
  cards: C[],
  subBoards: SubBoardRef[],
): Lane<C>[] {
  const cardById = new Map(cards.map((c) => [c.id, c]));
  // Sub-boards whose anchor card is visible in the input set.
  const visibleSubBoards = subBoards.filter(
    (s) => s.parentCardId !== null && cardById.has(s.parentCardId),
  );
  const subBoardByAnchor = new Map<string, SubBoardRef>(
    visibleSubBoards.map((s) => [s.parentCardId as string, s]),
  );
  const subBoardById = new Map(visibleSubBoards.map((s) => [s.id, s]));

  const childrenBySubBoard = new Map<string, C[]>();
  const orphans: C[] = [];
  const subtasksByParent = new Map<string, C[]>();

  for (const c of cards) {
    if (c.type === "subtask") {
      if (c.parentCardId) {
        const arr = subtasksByParent.get(c.parentCardId) ?? [];
        arr.push(c);
        subtasksByParent.set(c.parentCardId, arr);
      }
      continue;
    }
    // Anchor cards themselves render as their lane's header — skip placement.
    if (subBoardByAnchor.has(c.id)) continue;
    // Card whose board IS a visible sub-board → goes into that lane.
    if (subBoardById.has(c.boardId)) {
      const arr = childrenBySubBoard.get(c.boardId) ?? [];
      arr.push(c);
      childrenBySubBoard.set(c.boardId, arr);
      continue;
    }
    orphans.push(c);
  }

  function subtaskRowsFor(laneCardIds: Iterable<string>): Record<string, Array<PlacedCard<C>[]>> {
    const out: Record<string, Array<PlacedCard<C>[]>> = {};
    for (const parentId of laneCardIds) {
      const subs = subtasksByParent.get(parentId);
      if (!subs || subs.length === 0) continue;
      const placed = stackInLane(subs);
      const rows: Array<PlacedCard<C>[]> = [];
      for (const p of placed) {
        if (!rows[p.row]) rows[p.row] = [];
        rows[p.row].push(p);
      }
      out[parentId] = rows;
    }
    return out;
  }

  const subBoardLanes: Lane<C>[] = visibleSubBoards
    .map((s) => ({
      sub: s,
      anchor: cardById.get(s.parentCardId as string) as C,
    }))
    .sort((a, b) => {
      const ar = a.anchor.roadmapOrder ?? null;
      const br = b.anchor.roadmapOrder ?? null;
      if (ar !== null && br !== null) return ar - br;
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return a.anchor.title.localeCompare(b.anchor.title);
    })
    .map<Lane<C>>(({ sub, anchor }) => {
      const laneChildren = childrenBySubBoard.get(sub.id) ?? [];
      const ids: string[] = [anchor.id, ...laneChildren.map((c) => c.id)];
      return {
        id: sub.id,
        title: anchor.title,
        kind: "sub_board",
        headerCard: anchor,
        cards: laneChildren,
        subtaskRowsByParent: subtaskRowsFor(ids),
      };
    });

  const orphanLanes: Lane<C>[] = orphans
    .slice()
    .sort((a, b) => {
      const ar = a.roadmapOrder ?? null;
      const br = b.roadmapOrder ?? null;
      if (ar !== null && br !== null) return ar - br;
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return a.title.localeCompare(b.title);
    })
    .map<Lane<C>>((c) => ({
      id: c.id,
      title: c.title,
      kind: "uncategorized",
      headerCard: c,
      cards: [],
      subtaskRowsByParent: subtaskRowsFor([c.id]),
    }));

  return [...subBoardLanes, ...orphanLanes];
}
```

Also drop the `c.type === "epic"` skip lines in `groupByAssignee` (line 181) and `groupByComponent` (line 251). The remaining `c.type === "subtask"` skips stay.

- [ ] **Step 6.4: Run the test, watch it pass**

Run: `npx vitest run tests/unit/roadmap-layout.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Run the broader unit suite**

Run: `npx vitest run tests/unit`
Expected: PASS (no regressions). Any newly-failing test in this batch points at a consumer of `Lane.kind === "epic"` — fix at the call site, then re-run.

- [ ] **Step 6.6: Commit**

```bash
git add lib/roadmap/layout.ts tests/unit/roadmap-layout.test.ts
git commit -m "refactor(roadmap): replace groupByEpic with groupBySubBoard"
```

---

## Task 7: Wire `groupBySubBoard` into `roadmap-view.tsx`

**Files:**
- Modify: `components/roadmap/roadmap-view.tsx` (lines 33, 201, 246, 811, 946-949, 1557, 1596, 1631-1667 — confirm exact ranges by reading the file first)

- [ ] **Step 7.1: Update the import**

Change line 33:

```ts
  groupByEpic,
```

to:

```ts
  groupBySubBoard,
  type SubBoardRef,
```

(`SubBoardRef` is consumed below; see Step 7.3.)

- [ ] **Step 7.2: Update the URL lane-mode default**

Line 201 (default lane mode) — `: "epic"` → `: "sub_board"`. Then line 949 inside the URL sync effect: `if (next === "epic")` → `if (next === "sub_board")`.

- [ ] **Step 7.3: Provide a `subBoards` source**

The board-store snapshot already exposes `cardSubboards: { cardId, subBoardId, title }[]` (from your recent work, Task 5 of the sub-board pointer rollout). Map it once near the top of the component (right after the `cards` derivation) into the `SubBoardRef[]` shape:

```ts
const subBoards: SubBoardRef[] = useMemo(
  () =>
    cardSubboards.map((cs) => ({
      id: cs.subBoardId,
      title: cs.title,
      parentCardId: cs.cardId,
    })),
  [cardSubboards],
);
```

(`cardSubboards` is read from the store via the existing `useBoardStore` hook — confirm the selector name by grepping `stores/board-store.ts` first; if the public name differs, use it.)

- [ ] **Step 7.4: Swap the call**

Line 811:

```ts
    return groupByEpic(cards);
```

→

```ts
    return groupBySubBoard(cards, subBoards);
```

- [ ] **Step 7.5: Rename `epicHeader` → `laneHeaderCard` and surrounding locals**

In the JSX block around 1631-1667 (lane rendering), rename every `epicHeader` to `laneHeaderCard`. `draggable` condition on line 1632: `laneMode === "epic"` → `laneMode === "sub_board"`. The `data-testid="lane-epic-header-label"` on line 1666 → `data-testid="lane-header-label"`.

- [ ] **Step 7.6: Strip the epic-marketing helper line**

Around line 1596:

```tsx
                Mark a card as <span className="chip mono-meta-sm">Epic</span> to organize work into kanbans.
```

Replace with:

```tsx
                Open a card and choose <span className="chip mono-meta-sm">Make sub-board</span> to organize work into lanes.
```

- [ ] **Step 7.7: Update inline comments**

Lines 246, 1557, 1637 — the wording references "epic" but the behaviour is generic to "lane anchor". Reword inline: replace "epic" with "sub-board" or "lane anchor" as fits each sentence. Read the file first; preserve indentation.

- [ ] **Step 7.8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7.9: Commit**

```bash
git add components/roadmap/roadmap-view.tsx
git commit -m "refactor(roadmap): consume groupBySubBoard from roadmap view"
```

---

## Task 8: Update the lane-mode picker (`roadmap-header.tsx`)

**Files:**
- Modify: `components/roadmap/roadmap-header.tsx:33-36`

- [ ] **Step 8.1: Replace the lane-mode literal**

Change:

```ts
export type LaneMode = "epic" | "assignee" | "component";
export const LANE_MODES: LaneMode[] = ["epic", "assignee", "component"];
```

to:

```ts
export type LaneMode = "sub_board" | "assignee" | "component";
export const LANE_MODES: LaneMode[] = ["sub_board", "assignee", "component"];
```

And the label map entry:

```ts
  epic: "By epic",
```

→

```ts
  sub_board: "By sub-board",
```

- [ ] **Step 8.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the consumers in `roadmap-view.tsx` and the drag harness already expect `sub_board` after Tasks 7 and 9).

- [ ] **Step 8.3: Commit**

```bash
git add components/roadmap/roadmap-header.tsx
git commit -m "refactor(roadmap): rename lane mode 'epic' to 'sub_board'"
```

---

## Task 9: Rename `epicId` → `laneAnchorId` in the drag harness

**Files:**
- Modify: `components/roadmap/use-roadmap-drag-harness.ts` (lines 96, 249, 265, 581, 688, 710-721, 837, 1051, 1136-1146, 1194-1207, 1254, 1299-1309 — confirm by reading first)

- [ ] **Step 9.1: Mechanical rename**

Use a single `replace_all`-style edit on the file:
- `epicId` → `laneAnchorId` (every occurrence — including the property name in the drag-state type)
- `targetEpicId` → `targetLaneAnchorId`
- Local variables `epic` (lines 1194, 1299) → `laneAnchor`
- Local variables `epicBoardId` (lines 1136, 1195, 1300) → `laneAnchorBoardId`
- The two `laneMode === "epic"` (lines 837, 1051) → `laneMode === "sub_board"`
- The string literal `"Uncategorized"` on line 713 is fine — that's a user-facing fallback name, not an epic reference.
- Comments mentioning "epic" — reword to "sub-board" / "lane anchor".

- [ ] **Step 9.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9.3: Commit**

```bash
git add components/roadmap/use-roadmap-drag-harness.ts
git commit -m "refactor(roadmap): rename epicId to laneAnchorId in drag harness"
```

---

## Task 10: Update list-view + me-timeline-view hierarchy

**Files:**
- Modify: `components/roadmap/roadmap-list-view.tsx` (lines 10, 75, 127-154, 200, 228)
- Modify: `components/me/me-timeline-view.tsx` (lines 7, 64, 100-101, 255, 297)

Both files use the same `type === "epic"` flag to identify the depth-0 "anchor" row. After this plan the depth-0 anchor is a card that has a sub-board attached. The cleanest signal at the component level is: the card's `id` is the `parentCardId` of one of the sub-boards available in props.

- [ ] **Step 10.1: Thread `subBoards` (or a derived `Set<string>` of anchor ids) into both components**

Both files are pure-render and accept their data via props. Add a new optional prop `laneAnchorCardIds?: Set<string>` (default `new Set()`). Derive it once at the parent (roadmap-view.tsx) from `subBoards.map(s => s.parentCardId)` and pass it down. Update both component prop type declarations accordingly.

- [ ] **Step 10.2: `roadmap-list-view.tsx` — replace epic checks**

- Line 75 comment: `0 = epic, 1 = task/story/bug, 2 = subtask` → `0 = lane anchor, 1 = task/story/bug, 2 = subtask`.
- Lines 127-133: rename `topLevel` / `epicsFirst` sort. The new sort key — anchors first, then everyone else — uses `laneAnchorCardIds.has(card.id)` in place of `card.type === "epic"`.
- Line 154: `top.type === "epic" ? 0 : 1` → `laneAnchorCardIds.has(top.id) ? 0 : 1`.
- Line 200: `const isEpic = card.type === "epic";` → `const isLaneAnchor = laneAnchorCardIds.has(card.id);`. Rename the variable wherever it's used downstream (line 228 ternary).

- [ ] **Step 10.3: `me-timeline-view.tsx` — mirror the changes**

Same swap: lines 100-101 sort key, line 255 `isEpic` → `isLaneAnchor`, line 297 conditional class. Comments on lines 7 and 64 — reword "epic → child → subtask" to "anchor → child → subtask".

- [ ] **Step 10.4: Typecheck + unit suite**

Run: `npx tsc --noEmit && npx vitest run tests/unit`
Expected: clean / PASS.

- [ ] **Step 10.5: Commit**

```bash
git add components/roadmap/roadmap-list-view.tsx components/me/me-timeline-view.tsx
git commit -m "refactor(roadmap): list/timeline depth-0 keyed by lane anchor, not type"
```

---

## Task 11: Filter bars, board-filters, dashboard gadget

**Files:**
- Modify: `lib/board-filters.ts:256-258`
- Modify: `components/board/board-filter-bar.tsx:31`
- Modify: `components/roadmap/roadmap-filter-bar.tsx:33`
- Modify: `components/dashboard/gadgets/gadget-cards-by-type.tsx:1`

- [ ] **Step 11.1: `lib/board-filters.ts`**

Line 256 — `const TYPE_ORDER = ["epic", "story", "task", "subtask", "bug"] as const;` → drop `"epic"`:
```ts
    const TYPE_ORDER = ["story", "task", "subtask", "bug"] as const;
```
Line 258 — delete the `epic: "Epic",` entry from the label map.

- [ ] **Step 11.2: `components/board/board-filter-bar.tsx:31`**

```ts
const TYPE_OPTIONS = ["epic", "task", "subtask", "bug"] as const;
```
→
```ts
const TYPE_OPTIONS = ["task", "subtask", "bug"] as const;
```

(Note: the existing array already omits `"story"` by design — keep that as-is.)

- [ ] **Step 11.3: `components/roadmap/roadmap-filter-bar.tsx:33`**

Same change as Step 11.2.

- [ ] **Step 11.4: `components/dashboard/gadgets/gadget-cards-by-type.tsx:1`**

```ts
const TYPE_ORDER = ["epic", "story", "task", "subtask", "bug"] as const;
```
→
```ts
const TYPE_ORDER = ["story", "task", "subtask", "bug"] as const;
```

- [ ] **Step 11.5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11.6: Commit**

```bash
git add lib/board-filters.ts components/board/board-filter-bar.tsx components/roadmap/roadmap-filter-bar.tsx components/dashboard/gadgets/gadget-cards-by-type.tsx
git commit -m "refactor(filters): drop epic from type pickers and gadgets"
```

---

## Task 12: Rewrite the AIWEPI seeder to use sub-boards + anchor cards

**Files:**
- Modify: `scripts/seeds/aiwepi.mjs` — lines 25-29 (header comment), 489-546 (sub-board + overview card insert), 581-599 (deliverable insert is fine; verify)

- [ ] **Step 12.1: Update the header comment**

Edit lines 7-34. The new structure description:

```
// Logical structure
//   Workspace "AIWEPI Switch"
//   └─ Parent board "AIWEPI Project Plan"  (carries the 5 WP anchor cards + milestones)
//      └─ 5 sub-boards (one per WP, each attached 1:1 to its anchor card
//         via boards.parent_card_id from migration 0105)
//         └─ each sub-board:
//            ├─ Tx.y task-cards (type=story)        ← children of the anchor card
//            └─ Dx.y.z deliverable-cards (type=subtask) ← children of their related task
```

Update the date/owner section to drop the "type='epic' overview" caveat (lines 528-533 in the current file are now obsolete) and the "groupByEpic" follow-up note.

- [ ] **Step 12.2: Rewrite the sub-board + anchor-card creation block**

Replace the current pattern (sub-board → epic-typed Overview card → tasks) with: anchor card on the parent board → sub-board linked to it → tasks on the sub-board.

The relevant block (around lines 489-546 currently) becomes:

```js
for (const wp of WORK_PACKAGES) {
  const wpStatus = statusFor(wp.startMonth, wp.endMonth);

  // 1. Anchor card lives on the parent board so it shows in the parent
  //    board's lists AND on the workspace roadmap as the WP lane header.
  const [anchorCard] = await call("cards", {
    list_id: parentBoardLists[wpStatus],
    board_id: parentBoard.id,
    title: wp.title,
    position: nextPos(),
    type: "story",
    owner_id: null,
    description: `**${wp.kind}** · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
    start_date: monthDateStr(wp.startMonth),
    target_date: monthDateStr(wp.endMonth),
    completed_at:
      wpStatus === "done" ? monthStart(wp.endMonth).toISOString() : null,
  });

  // 2. Sub-board attached 1:1 to the anchor card.
  const [subBoard] = await call("boards", {
    workspace_id: ws.id,
    parent_board_id: parentBoard.id,
    parent_card_id: anchorCard.id,
    title: wp.title,
    visibility: "workspace",
    created_by: userId,
  });
  await call("board_members", {
    board_id: subBoard.id,
    user_id: userId,
    role: "admin",
  });
  console.log(`  ${wp.code} sub-board: ${subBoard.id} (anchor ${anchorCard.id})`);

  const subLists = {};
  for (const [i, l] of DEFAULT_LISTS.entries()) {
    const [row] = await call("lists", {
      board_id: subBoard.id,
      title: l.title,
      position: `a${String(i + 1).padStart(6, "0")}`,
      status_kind: l.statusKind,
    });
    subLists[l.statusKind] = row.id;
  }

  positionCounter = 0;

  // Tasks — parented to the anchor card and homed on the sub-board.
  const taskRows = [];
  for (let i = 0; i < wp.tasks.length; i++) {
    const t = wp.tasks[i];
    const range = sliceRange(wp.startMonth, wp.endMonth, wp.tasks.length, i);
    const taskStart = Math.round(range.startMonth);
    const taskEnd = Math.round(range.endMonth);
    const status = statusFor(taskStart, taskEnd);
    const [row] = await call("cards", {
      list_id: subLists[status],
      board_id: subBoard.id,
      title: t.title,
      position: nextPos(),
      type: "story",
      owner_id: null,
      parent_card_id: anchorCard.id,
      description: t.description,
      start_date: monthDateStr(taskStart),
      target_date: monthDateStr(taskEnd),
      completed_at:
        status === "done" ? monthStart(taskEnd).toISOString() : null,
    });
    taskRows.push({ row, taskStart, taskEnd });
  }

  // Deliverables (type=subtask) — parented to their related task (unchanged).
  for (const d of wp.deliverables) {
    const parent = taskRows[d.underTaskIndex ?? 0];
    if (!parent)
      throw new Error(`${wp.code} ${d.code}: underTaskIndex out of bounds`);
    const status = statusFor(parent.taskStart, parent.taskEnd);
    await call("cards", {
      list_id: subLists[status],
      board_id: subBoard.id,
      title: d.title,
      position: nextPos(),
      type: "subtask",
      owner_id: null,
      parent_card_id: parent.row.id,
      description: d.description,
      target_date: monthDateStr(parent.taskEnd),
      completed_at:
        status === "done" ? monthStart(parent.taskEnd).toISOString() : null,
    });
  }
}
```

- [ ] **Step 12.3: Capture parent board list ids**

The current seeder inserts parent-board lists in a for-loop but doesn't keep their ids. Modify the parent board list-creation block (lines 480-487) to collect ids:

```js
const parentBoardLists = {};
for (const [i, l] of DEFAULT_LISTS.entries()) {
  const [row] = await call("lists", {
    board_id: parentBoard.id,
    title: l.title,
    position: `a${String(i + 1).padStart(6, "0")}`,
    status_kind: l.statusKind,
  });
  parentBoardLists[l.statusKind] = row.id;
}
```

(Used by the anchor-card insert in Step 12.2.)

- [ ] **Step 12.4: Dry-run via lint + parse check**

Run: `node --check scripts/seeds/aiwepi.mjs && npm run lint -- scripts/seeds/aiwepi.mjs`
Expected: both succeed. (Don't actually execute the seeder yet — that needs migration 0106 applied first; covered in Task 15.)

- [ ] **Step 12.5: Commit**

```bash
git add scripts/seeds/aiwepi.mjs
git commit -m "refactor(seeds): aiwepi anchor card on parent board, sub-board attached via parent_card_id"
```

---

## Task 13: Tests cleanup

**Files:**
- Modify: `tests/integration/card-types.test.ts:37-42`
- Modify: `tests/integration/seed-demo.test.ts:72` (verify only — likely no change)
- Inspect + maybe delete: `tests/unit/epic_migration_ui.test.ts`
- Modify: `tests/e2e/gantt-drag-first.spec.ts` (multiple lines)
- Modify: `tests/e2e/jira-structure.spec.ts:93` (comment only)
- Modify: `tests/e2e/jira-gantt-integration.spec.ts:156` (comment only)

- [ ] **Step 13.1: `tests/integration/card-types.test.ts`**

Open the file. Around line 37:

```ts
it("defaults to task and rejects the retired epic type", async () => {
  ...
  await expect(updateCardImpl(u.jwt, { id: c.id, type: "epic" })).rejects.toThrow(
    ...
  );
});
```

The Zod enum no longer accepts `"epic"` so the parse fails before the action body runs. Replace the rejection assertion with a Zod-level expectation (read the file's existing test style first; mirror the assertion shape):

```ts
import { CardType } from "@/lib/validation";

it("defaults to task and rejects the retired epic type", async () => {
  // ... existing default-to-task arrange/act stays
  expect(CardType.safeParse("epic").success).toBe(false);
});
```

(If the test was relying on the action-layer `updateCardImpl` throw, the call itself now throws a Zod parse error — keep the wrapping `await expect(...).rejects.toThrow()` and broaden the matcher to `.toThrow(/Invalid enum/i)`.)

- [ ] **Step 13.2: `tests/integration/seed-demo.test.ts`**

Read line 72. The current assertion `expect(types.has("epic")).toBe(false);` continues to be valid (no seed produces an epic). No change required. If a surrounding comment claims epic is "retired but still possible", reword to "removed".

- [ ] **Step 13.3: Decide on `tests/unit/epic_migration_ui.test.ts`**

Open the file. Read the whole thing.

- If it asserts UI behaviour of the now-removed migration affordance → `git rm tests/unit/epic_migration_ui.test.ts`.
- If it asserts pure migration-projection logic that's still relevant for documenting how 0100 ran → leave it (it operates on synthetic fixtures, just like `subboard-migration.test.ts`).

Document the decision in the commit message.

- [ ] **Step 13.4: `tests/e2e/gantt-drag-first.spec.ts`**

Read the whole file first (it's ~400+ lines). Apply these renames (mechanical):
- `epicBLane` → `subBoardBLane`
- `epicBBox` → `subBoardBBox`
- `epicBLane2` → `subBoardBLane2`
- `epicBBox2` → `subBoardBBox2`
- `epicLane` → `subBoardLane`
- `getByTestId("lane-epic-header-link")` → `getByTestId("lane-header-link")`
- All comment occurrences of "epic" → "sub-board" or "lane anchor" as fits.

Then add the matching `data-testid` to `roadmap-view.tsx` (in Task 7) if it's not already there — confirm with a grep at the end of this task.

- [ ] **Step 13.5: `tests/e2e/jira-structure.spec.ts` + `jira-gantt-integration.spec.ts`**

Comment-only edits — replace "epic" wording with "anchor card" / "sub-board" wherever it appears in the `//` comments. No assertions change.

- [ ] **Step 13.6: Run the unit + integration suites**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS.

- [ ] **Step 13.7: Commit**

```bash
git add tests/
git commit -m "test: align test suites with epic-type removal"
```

---

## Task 14: Full-codebase verification sweep

- [ ] **Step 14.1: Grep for any remaining `epic` references**

Run: `rtk proxy grep -rEn "'epic'|\"epic\"|isEpic|type === \"epic\"|epicId|EpicTile|groupByEpic|listEpicsInWorkspace" --include="*.ts" --include="*.tsx" --include="*.mjs" lib/ components/ app/ actions/ stores/ scripts/ tests/`
Expected: zero hits. Any survivors are bugs in the plan — fix them inline and re-run.

- [ ] **Step 14.2: Migration files**

Run: `rtk proxy grep -rn "epic" supabase/migrations/0106_drop_epic_type.sql`
Expected: matches inside the new migration only (it references the old type to drop it). Other migrations (0018, 0051, 0052, 0053, 0061, 0099, 0100) **stay unchanged** — they're history.

- [ ] **Step 14.3: Static checks**

Run: `npm run lint && npx tsc --noEmit`
Expected: lint reports the same 3 pre-existing warnings you have today and 0 errors; tsc clean.

- [ ] **Step 14.4: Commit any sweep-up fixes (only if any)**

If the grep in 14.1 found stragglers, commit:

```bash
git add -A
git commit -m "chore: sweep remaining epic references"
```

If everything's already green, this step is a no-op.

---

## Task 15: Apply migration + run integration tests against the new DB

**Note:** This is the only step that hits a live Supabase instance. Defer until reviewer sign-off if needed.

- [ ] **Step 15.1: Apply the migration**

Run: `supabase migration up`
Expected: `0106_drop_epic_type` listed under "Applied migrations".

- [ ] **Step 15.2: Run integration tests**

Run: `npx vitest run tests/integration`
Expected: PASS. Pay special attention to `card-subboard.test.ts` (your recent addition) — should keep passing because nothing about the sub-board pointer changed semantically; only the epic backfill ran.

- [ ] **Step 15.3: Re-seed the AIWEPI fixture**

Run: `SEED_RESET=true ./scripts/seeds/run.sh aiwepi`
Expected: prints `Workspace AIWEPI Switch:` and lists 5 sub-boards each with an anchor card id. Then open the workspace roadmap manually and confirm:
- 5 lanes named `WP1.1 … WP1.5` (full WP titles, not "Overview" — title comes from the anchor card now).
- Tasks (T1.1, T2.1, T2.2, …) appear under the correct lane.
- Deliverables (D1.x.y) are nested as subtasks under their tasks (expand to verify).
- Milestones still pin at the top of the timeline.

- [ ] **Step 15.4: Final commit (none needed if test runs are clean)**

This is a verification step; no code changes expected.

---

## Self-Review Pass

After all tasks above:

1. **Spec coverage:** every `epic` reference enumerated in the file-structure section maps to a task. The DB layer is covered by Task 1; the schema by Task 2; the validation/rules by Task 3; runtime guard by Task 4; queries/page/grid by Task 5; roadmap layout by Task 6-10; filters/gadgets by Task 11; seeder by Task 12; tests by Task 13; sweep by Task 14; apply+verify by Task 15. ✅

2. **Placeholder scan:** the plan contains no "TBD" / "fill in" / "implement later" — every code change has explicit before/after snippets. ✅

3. **Type consistency:** `groupBySubBoard(cards, subBoards)` signature appears identically in `lib/roadmap/layout.ts` (Task 6), the test (Task 6.1), and the call site (`roadmap-view.tsx` Task 7.4). `LaneMode` literal `"sub_board"` is used consistently across `roadmap-header.tsx` (Task 8), `roadmap-view.tsx` (Task 7.2), and the drag harness (Task 9.1). `Lane.kind` values `"sub_board" | "uncategorized" | "assignee" | "component"` match across the layout module and its tests. ✅

4. **Migration safety:** Task 1's migration is idempotent (`if exists` / `if not exists` guards, plus the backfill is gated on `parent_card_id is null` so re-runs don't clobber Task 5's earlier work) and the demote step runs before the check-constraint swap, avoiding violation on partial replay. ✅

5. **Test discipline:** Task 6 follows red→green TDD for the layout refactor. Task 13 explicitly walks through every existing test that touches epic, marking each as keep/modify/delete. ✅
