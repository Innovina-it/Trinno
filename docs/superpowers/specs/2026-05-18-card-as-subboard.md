# Card-as-Sub-Board

Date: 2026-05-18
Branch: `plan/01-foundation`
Migration: `0105_card_sub_board_pointer.sql`
Status: backend + UI shipped, integration tests green, awaiting browser-against-real-artifact verification

Documented in the loop shape from `the-system.pdf` — one unit, five phases.

---

## Spec

### Goal
A user can create a new card as a sub-board, or convert an existing card into a sub-board, from the standard card UI. The card stays a normal card on the parent kanban; clicking through opens a full board view containing its own lists and cards.

### Done looks like
- The new-card dialog (`+ Add card` on a list and the `c`-hotkey/FAB quick-add) shows a "Create as sub-board" checkbox.
- When checked and the form is submitted, a card is created in the chosen list and a child board is created with `parent_board_id = current board` and `parent_card_id = card`. The child board is seeded with `Todo / In Progress / Done`.
- The new card renders on the parent list with its title, type, assignee, dates — and a `SUB-BOARD` chip. Clicking the chip navigates to `/b/<subBoardId>`.
- The card-modal of an existing card shows a "Make sub-board" button. Clicking it creates the same kind of child board, idempotently (the partial unique index on `boards.parent_card_id` rejects a second promote).
- The card-modal of a card that already has a sub-board shows an "Open sub-board" link instead of the promote button.
- Sub-board pages render through the existing `/b/[boardId]/page.tsx` → `BoardView` path. An empty sub-board lands on a normal kanban with the three seeded lists — not an error, not a blank screen.

### Must not change
- Regular cards (toggle off) behave exactly as before: create, edit, move, delete, assign, due-date — unchanged.
- The four card types (Story / Task / Subtask / Bug) still appear and are still locked after creation (TB-04).
- Existing sub-boards produced by the Epic migration continue to render. They use `parent_board_id` only, with `parent_card_id IS NULL`, so the new tile-chip / modal-link skip them naturally.
- Bulk-archive cap of 50, lazy-history flag behaviour, default-lists-on-new-board behaviour, and the `c` keyboard shortcut are untouched.
- Permissions: a workspace member still cannot create a board (TB-46). The sub-board path applies the same gate, because a sub-board *is* a board — `createSubboardImpl` pre-checks `workspace_members.role IN ('owner','admin')` and `boards_admin_write` RLS enforces on INSERT.

---

## Decompose

Units, in dependency order. Each landed as its own commit candidate. Write-sets listed so future passes can see what overlaps with what.

| # | Unit | Write-set | Depends on |
|---|------|-----------|------------|
| 1 | DB column + 1:1 partial unique idx | `supabase/migrations/0105_card_sub_board_pointer.sql` | — |
| 2 | Drizzle schema field | `lib/db/schema.ts` (`boards.parentCardId`) | 1 |
| 3 | Zod inputs | `lib/validation.ts` (`CreateSubboardInput`, `PromoteCardToSubboardInput`) | — |
| 4 | Server actions | `actions/boards.ts` (`createSubboardImpl`, `promoteCardToSubboardImpl`, wrappers) | 2, 3 |
| 5 | Snapshot enrichment | `lib/queries/board-snapshot.ts` (`cardSubboards: CardSubboardRow[]`) | 2 |
| 6 | Client store plumbing | `stores/board-store.ts` (`cardSubboards`, `upsertCardSubboard`, `removeCardSubboard`); `app/(app)/b/[boardId]/layout.tsx` (initial pass-through) | 5 |
| 7a | New-card dialog toggle | `components/board/new-card-dialog.tsx` | 4 |
| 7b | Quick-add dialog toggle | `components/quick-add-card-dialog.tsx` (board-mode + global-mode) | 4 |
| 7c | Card-modal Open/Promote affordance | `components/board/card-modal.tsx` | 4, 6 |
| 7d | Tile chip + drill-in | `components/board/card-tile.tsx` | 6 |
| 8 | Feature-flag gate | `useWorkspaceFlag("subboards_enabled", true)` applied to 7a / 7b / 7c (chip in 7d stays on so attached sub-boards remain visible if flag flipped off) | 7 |
| 9 | Integration tests | `tests/integration/card-subboard.test.ts` | 1–6 |

7a / 7b / 7c / 7d are parallel-safe — disjoint files, no shared state beyond the snapshot they all read. 9 is parallel-safe with 7 once 1–6 land.

Pre-conditions for verification: integration suite already exists (Supabase running locally), test fixtures use service-role auth — no new seed scripts needed. The `subboards_enabled` workspace flag defaults `true` via the hook fallback, so no DB edit is required to exercise the affordance.

---

## Build

| Commit-sized chunk | Files touched |
|---|---|
| Schema + migration | `supabase/migrations/0105_card_sub_board_pointer.sql`, `lib/db/schema.ts` |
| Validation + server actions | `lib/validation.ts`, `actions/boards.ts` |
| Snapshot + store | `lib/queries/board-snapshot.ts`, `stores/board-store.ts`, `app/(app)/b/[boardId]/layout.tsx` |
| UI affordances | `components/board/new-card-dialog.tsx`, `components/quick-add-card-dialog.tsx`, `components/board/card-modal.tsx`, `components/board/card-tile.tsx` |
| Tests | `tests/integration/card-subboard.test.ts` |

Build choices made explicit:
- **No new abstraction.** The promote path is two lines in `createSubboardImpl`: look up the card, delegate. Nothing extracted to a shared module — single use, no harvest target yet.
- **Child board reuses the existing board route.** No new `/b/[boardId]/subboard` URL. `/b/<subBoardId>` already runs through `BoardView`, so the "looks like a real board" requirement falls out for free.
- **Idempotency at the DB layer**, not at the action layer. The partial unique index on `boards.parent_card_id` is the source of truth. The action surfaces the uniqueness error as-is; we don't catch-and-re-fetch.
- **Tile chip click is `stopPropagation`'d** so the row click still opens the card modal. Card body click → modal. Chip click → board view. Same model as the roadmap-link chip in the card-modal.

---

## Verify

### Tripwire layer — what the existing fixed regression pass must still cover
The change touches code that was already protected. These tests must still pass:
- `tests/integration/epic-children.test.ts` — confirms legacy `parent_board_id`-only sub-boards still render via `listSubboardChildren`.
- `tests/unit/subboard-migration.test.ts` — confirms the Epic → sub-board model still holds.
- `tests/integration/card-types.test.ts` — confirms the four card types still load and lock.

Status: `vitest run tests/unit` → 76 suites / 160 tests passing (post-change).

### Per-unit verification — written from the "Must not change" list

| Invariant | Executable check |
|---|---|
| Promote a card produces a valid child board | `tests/integration/card-subboard.test.ts` — *promoteCardToSubboardImpl creates a child board anchored to the card* |
| Sub-board info reaches the kanban via the snapshot | *getBoardSnapshot.cardSubboards surfaces the pointer to the parent kanban* |
| Anchor card must belong to the parent board | *createSubboardImpl rejects an anchor card from a different board* |
| 1:1 enforcement | *promoting the same card twice violates the 1:1 unique index* |

Status: 4 / 4 passing (run 2026-05-18 against migrated local Supabase).

### Real-artifact verification (the layer the system says we cannot skip)
Code-against-code is clean. Browser-against-real-artifact is the layer that catches what tsc / vitest cannot:

| # | Scenario | Observable pass condition |
|---|---|---|
| 1 | List "+ Add card" → check "Create as sub-board" → submit. | Card appears on parent list. `SUB-BOARD` chip visible. Clicking chip navigates to `/b/<id>`. Sub-board page shows seeded `Todo / In Progress / Done`. |
| 2 | `c` hotkey quick-add (board mode) with toggle on. | Same as #1. Toast reads "Card + sub-board added". |
| 3 | `c` hotkey quick-add (global mode) with toggle on. | Same, but the card lands in the selected board/list. |
| 4 | Open existing card modal → "Make sub-board". | Button replaced by "Sub-board: <title> →" link. Tile shows `SUB-BOARD` chip without page reload. |
| 5 | Tripwire: existing Epic-migrated sub-board page. | Renders identically to before. No `SUB-BOARD` chip on its parent because epic-migrated boards have `parent_card_id IS NULL`. |
| 6 | Tripwire: regular card (toggle off). | Indistinguishable from the pre-change build. |
| 7 | Tripwire: workspace member (non-admin) opens any new-card dialog with toggle on. | Card creation succeeds. Sub-board create surfaces "Only workspace owners and admins can create sub-boards." as a toast; card row is intact. |
| 8 | Empty sub-board first-visit. | Renders the standard board view with three empty lists, not a 500, not a blank `<main>`. |
| 9 | Flag flip: set `workspaces.feature_flags->>'subboards_enabled' = 'false'`. | Toggles disappear from both dialogs. Promote button disappears from card-modal. Existing attached sub-boards still render and the `SUB-BOARD` chip still navigates. |

UNKNOWN — needs decision: scenarios 1–9 have not yet been executed against the running app by a human observer. The agent that built the unit is the same agent that wrote the test list. Per the system, the high-risk independent observer is not delegable.

---

## Manual test procedure

Run these against `npm run dev` against the local Supabase (migration `0105` applied). Record the result for each row in the **Completion criteria** table at the bottom of this doc — paste the toast text, an observation note, or a screenshot path. UNKNOWN stays UNKNOWN until a human has executed the row.

### Preconditions
- `supabase status` reports running. Migration `0105_card_sub_board_pointer.sql` applied.
- `npm run dev` is up at `http://localhost:3000`.
- You are signed in as a **workspace owner or admin** for the workspace under test. Note the workspace UUID and pick one board in it ("the test board"). Note the test board's UUID.
- For scenario 7, a second user invited to the same workspace as `member` (not admin). If one does not exist, create via Supabase Studio → Authentication → Add user, then `insert into workspace_members(workspace_id, user_id, role) values ('<ws>', '<userId>', 'member');`.
- For scenario 9, you will run one SQL statement in Studio. Have the workspace UUID handy.

### Scenario 1 — List "+ Add card" with sub-board toggle (golden path)
1. Open the test board (`/b/<boardId>`).
2. At the bottom of any list click `+ Add card`. The dialog `New card` opens.
3. Confirm a row labelled **CREATE AS SUB-BOARD** is visible with a layers-3 icon and the explanatory text `· adds a child board anchored to this card`.
4. Type title `Test subboard 1`. Leave type = Task, dates = defaults.
5. Tick the **CREATE AS SUB-BOARD** checkbox.
6. Click **Create card**.
7. **Observe:** toast `Created card "Test subboard 1"`. Card row appears on the chosen list.
8. **Observe:** the card tile renders a `SUB-BOARD` chip (next to the existing chips, before TileIndicators).
9. Click the `SUB-BOARD` chip. Browser navigates to `/b/<subBoardId>`.
10. **Observe:** the sub-board page renders the same kanban shell as the parent. Three seeded lists `Todo`, `In Progress`, `Done`, all empty. Header shows `Test subboard 1`.
11. Browser back. You land back on the parent board with the card row intact.

**Pass condition:** steps 7–10 each observable as described.

### Scenario 2 — `c` quick-add, board mode
1. From the test board page, press `c` (no input field focused).
2. The quick-add dialog opens. Confirm the list dropdown + title input + a checkbox row labelled **Create as sub-board** with the layers-3 icon.
3. Pick a list, type `Test subboard 2`, tick the checkbox, submit.
4. **Observe:** toast text contains `Card + sub-board added`. The card appears on the chosen list. Chip visible.

**Pass condition:** toast text is `Card + sub-board added`, chip renders.

### Scenario 3 — `c` quick-add, global mode
1. Navigate to a non-board page in the app (e.g. workspace landing `/w/<workspaceId>`).
2. Press `c`. The global quick-add dialog opens.
3. Pick the test workspace's test board, pick a list, type `Test subboard 3`, tick **Create as sub-board**, submit.
4. **Observe:** toast `Card + sub-board added`.
5. Navigate to the test board. Card row + `SUB-BOARD` chip both present.

**Pass condition:** card and chip end up on the chosen board, even though creation happened from outside the board context.

### Scenario 4 — Convert an existing card via card-modal
1. On the test board, click the body of any card that does **not** have a `SUB-BOARD` chip (a plain Task or Story works).
2. Card modal opens.
3. Locate **Make sub-board** button (next to the explanatory text `Adds a child board anchored to this card.`).
4. Click it. Button text changes to `Creating…` then the row swaps to `Sub-board: <card title> →` with a link.
5. **Observe:** no error toast. The original card's title, assignee, dates, type are unchanged.
6. Close the modal.
7. **Observe:** the card tile now shows the `SUB-BOARD` chip without a page reload (store mutation worked).
8. Click the chip. You land on the new sub-board page.

**Pass condition:** card properties intact post-promote, chip appears without reload, navigation works.

### Scenario 5 — Tripwire: Epic-migrated sub-boards unchanged
> Skip if this workspace has never run the epic→subboard migration. Otherwise:
1. Identify a board that was the parent for an epic→subboard migration (the boards from `0100_migrate_epics_to_subboards.sql`).
2. Open it.
3. **Observe:** the original anchor (epic) card has *no* `SUB-BOARD` chip — because `parent_card_id IS NULL` for epic-migrated child boards.
4. From the workspace board list, navigate directly to the migrated sub-board.
5. **Observe:** renders identically to before this change. Lists, cards, header all present.

**Pass condition:** no chip on legacy anchors, legacy sub-boards still load.

### Scenario 6 — Tripwire: regular card path unchanged
1. List `+ Add card` → leave the **CREATE AS SUB-BOARD** checkbox unticked.
2. Submit with any title.
3. **Observe:** card row appears as before. **No** `SUB-BOARD` chip. No new board created (verify in Supabase Studio: `select id, parent_card_id from boards where parent_card_id is not null;` should not include this card's id).
4. Repeat with `c` hotkey quick-add. Same result.

**Pass condition:** zero behavioural diff vs the pre-change build for the unticked path.

### Scenario 7 — Permission gate (member cannot create sub-board)
1. Sign out, sign in as the workspace `member` user (not admin/owner).
2. Open the test board. Click `+ Add card`.
3. Tick **CREATE AS SUB-BOARD**. Type a title. Submit.
4. **Observe two toasts in order:**
   - `Created card "<title>"` — the card row was created.
   - `Saved card, but sub-board create failed: Only workspace owners and admins can create sub-boards.` — promote was rejected.
5. **Observe:** the card row exists. No `SUB-BOARD` chip. In Studio: no row in `boards` with `parent_card_id = <new card id>`.
6. Re-open the card via its modal. **Observe:** Make sub-board button click fails with the same error.

**Pass condition:** card creation works, sub-board creation fails with the readable role message, no half-state in the DB.

### Scenario 8 — Empty sub-board first visit
1. Pick any sub-board you created in scenarios 1–3 and navigate directly to `/b/<subBoardId>`.
2. **Observe:** standard board view renders. Three empty lists. Header title matches the anchor card's title. No 500, no blank page.
3. Use `+ Add card` on a list of the sub-board itself. Create a normal child card. Confirm it persists.

**Pass condition:** empty sub-board renders clean and is usable as a normal board.

### Scenario 9 — Flag flip
1. Open Supabase Studio → SQL editor.
2. Run:
   ```sql
   update public.workspaces
   set feature_flags = coalesce(feature_flags, '{}'::jsonb)
     || jsonb_build_object('subboards_enabled', false)
   where id = '<workspace-uuid>';
   ```
3. Hard-reload the test board page.
4. **Observe in the parent board:**
   - `+ Add card` dialog: **CREATE AS SUB-BOARD** row is hidden.
   - `c` quick-add (board + global modes): **Create as sub-board** row is hidden.
   - Open any card without an existing sub-board: **Make sub-board** button is hidden.
   - Open a card that already has a sub-board: `Sub-board: <title> →` link is still visible.
   - Existing `SUB-BOARD` chips on tiles are still visible and still navigate.
5. Reset the flag:
   ```sql
   update public.workspaces
   set feature_flags = coalesce(feature_flags, '{}'::jsonb)
     || jsonb_build_object('subboards_enabled', true)
   where id = '<workspace-uuid>';
   ```
6. Reload. Confirm everything is back.

**Pass condition:** the toggle row and Promote button are flag-gated; the chip and Open link are not (existing data remains visible/navigable).

### Cleanup
Optional — clean test data:
```sql
-- delete sub-boards created by these tests (cascades to lists/cards in those boards)
delete from public.boards
where parent_card_id in (
  select id from public.cards where title like 'Test subboard %'
);
delete from public.cards where title like 'Test subboard %';
```

---

## Completion criteria

The doc is **complete** when every box in this table is filled with a real result (date + observer + outcome) and the bottom section is signed off. Replace `UNKNOWN` with a result line as you run each.

### Code-against-code gates
| Gate | Owner | Result |
|---|---|---|
| `npm run lint` clean (warnings unchanged) | agent | ✅ 2026-05-18 — 0 errors, 3 pre-existing warnings unrelated |
| `npx tsc --noEmit` clean | agent | ✅ 2026-05-18 |
| `npx vitest run tests/unit` green | agent | ✅ 2026-05-18 — 76 suites / 160 tests |
| `npx vitest run tests/integration/card-subboard.test.ts` green | user | ✅ 2026-05-18 — 4 / 4 |
| Tripwire still green: `tests/integration/epic-children.test.ts`, `tests/unit/subboard-migration.test.ts`, `tests/integration/card-types.test.ts` | user | UNKNOWN |
| `npm run build` succeeds | user | UNKNOWN |

### Real-artifact gates (the layer code-against-code cannot answer)
| Scenario | Result line (date · observer · pass/fail · notes) |
|---|---|
| 1 — List + Add card with toggle | 2026-05-18 · Ali · pass |
| 2 — `c` quick-add (board mode) | 2026-05-18 · Ali · pass |
| 3 — `c` quick-add (global mode) | 2026-05-18 · Ali · pass |
| 4 — Convert via card-modal | 2026-05-18 · Ali · pass (also added qv promote: card-quick-view-subboard-promote) |
| 5 — Epic-migrated tripwire | UNKNOWN (or N/A if no legacy data) |
| 6 — Regular-card tripwire | 2026-05-18 · Ali · pass |
| 7 — Permission gate (member) | UNKNOWN |
| 8 — Empty sub-board first visit | UNKNOWN |
| 9 — Flag flip | UNKNOWN |

### Harvest gate
- [ ] After all real-artifact rows pass, revisit the **Harvest** section. Either confirm "no candidates yet" or extract the actually-justified reuse / tripwire / spec entries that surfaced during execution. Sign-off line below.

### Sign-off
- Manual test executed by: `<name>` on `<date>`
- All real-artifact scenarios pass: yes / no (if no, list which failed + linked fix-up unit)
- Harvest reviewed: yes / no
- Branch merged into `main`: yes / no — commit SHA `<sha>`

Once all three are yes and the table has no UNKNOWN rows, the doc is complete and the unit moves out of in-progress.

To revisit once #1–#9 above have actually run:

### What's reusable?
- `createSubboardImpl` overlaps significantly with `createBoardImpl` (workspace-role pre-check, board insert, admin board-member, default-list seed). If a third "create some flavour of board" path appears, extract the shared body. Not now — second use only.
- The `useWorkspaceFlag(flag, true)` + `attached ? open : flag && promote` pattern in the card-modal will repeat for the next gated affordance. Worth a `<FlaggedAction>` helper on the third occurrence.

### What did the process miss?
- The `subboards_enabled` flag was introduced in `lib/feature-flags/index.ts` months ago with a TODO and was never wired. The unit closes that TODO incidentally — flag plumbing should have been called out as a sub-unit in Decompose rather than absorbed silently.
- The Decompose table classified 7a–7d as parallel-safe and the user-visible smoke test as one unit. In practice the modal and the tile both read the same store field, so a regression in #6 (store plumbing) would have shown up in both at once. The dependency on #6 should have been an explicit fan-out arrow rather than implied through "depends on 6."

### What gets fed back into the spec?
New "must not change" lines for future units that touch this area:
1. `boards.parent_card_id` is 1:1. Any future card-deletion path must either tolerate the FK `ON DELETE SET NULL` (current behaviour: sub-board is orphaned, becomes a parent_board-only board → effectively a legacy-migrated sub-board) or explicitly archive/delete the child board first.
2. Cascading: deleting the parent board sets `parent_board_id` NULL on the child (0099 behaviour). Combined with #1 above, deleting the parent board AND the anchor card leaves the child board fully orphaned. Cleanup is intentional and should be explicit if/when surfaced in UI.
3. `cardSubboards` is keyed off `archived = false` in the snapshot query. Archiving the child board removes the chip but leaves the card-modal pointer query asymmetric — flagged for next pass.
4. Real-time: card-modal calls `upsertCardSubboard` after the action returns, but other clients on the parent board will not see the chip until they re-fetch the snapshot. The realtime channel currently broadcasts card and board changes but not the `cardSubboards` projection. If/when sub-board promotes happen frequently in shared sessions, wire a realtime event for it.

### Candidate new tripwire entries
- A regression check that promoting card → board uses workspace background / visibility from the parent. The action does this today; a future refactor could regress it silently. Add to the integration suite once #5 (real-artifact verify) has run.
- A regression check that creating a card with the toggle ON leaves type/assignee/dates intact on the card row. Currently relied on by inspection.

---

## Open items
- Run the nine real-artifact scenarios above against the running app. Required before this unit moves from "code-complete" to "done."
- Decide policy on chip-only drill-in vs card-body drill-in. Spec line "clicking it opens a board view" was satisfied by the chip; clarification 2026-05-18 confirmed chip + modal-link is acceptable.
