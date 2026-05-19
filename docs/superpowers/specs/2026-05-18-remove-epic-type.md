# Remove the `epic` Card Type

Date: 2026-05-18
Branch: `plan/01-foundation`
Migration: `0106_drop_epic_type.sql`
Companion plan (executable steps): [`docs/superpowers/plans/2026-05-18-remove-epic-type.md`](../plans/2026-05-18-remove-epic-type.md)
Status: spec drafted, no code written

Documented in the loop shape from `the-system.pdf` — five phases, with the work split into units that each land as their own commit. The companion plan file holds the per-step code; this spec holds the framing, the dependency map, the verify discipline, and the harvest checklist.

---

## Blast-radius assessment (read before anything)

This is a **change to load-bearing infrastructure**, not a small fix:

- The DB enum that gates `cards.type` is touched. Every read/write path through `actions/cards.ts`, every filter UI, and every roadmap surface assumes this enum's shape.
- The roadmap's lane-grouping primitive (`groupByEpic`) is being replaced, not patched. Three roadmap surfaces (timeline view, list view, me-timeline view) and the drag harness all consume it.
- Production data may contain rows the migration must rewrite. Migration 0100 already moved epic descendants into sub-boards, but the original `type='epic'` anchor cards stayed on the parent boards. 0106 has to find them, link the sub-boards to them, and demote them in one transaction.

That blast radius is why this gets the full spec form rather than a one-liner prompt, and why Verify (below) splits the work into a tripwire pass, a per-unit pass, and a three-observer pass — not just "the tests pass."

---

## Spec

### Goal
Remove the deprecated `epic` card type from the entire codebase. After the change, work-package containment is expressed *only* via sub-boards (`boards.parent_board_id` from 0099 + `boards.parent_card_id` from 0105). The DB enum, the Zod enum, the rules enum, the runtime guards, the roadmap lane-grouping primitive, every filter / picker / dashboard gadget, the AIWEPI seeder, and every test that names `"epic"` are all updated in lockstep.

### Done looks like

**Database**
- `cards.type` check constraint allows `('story', 'task', 'subtask', 'bug')` — no `'epic'`.
- Zero rows in `cards` with `type = 'epic'`. Any survivors are demoted to `'story'` by 0106 before the constraint flips.
- Every sub-board produced by 0100 (rows with `boards._migrated_from_epic_id IS NOT NULL`) has `parent_card_id` populated and pointing at its anchor card (if that card still exists).
- Triggers `cards_validate_epic_parent_biu`, `cards_co_locate_with_epic_parent_biu`, `cards_reject_epic_with_epic_children_bu`, `cards_rollup_epic_dates_aiu`, `cards_rollup_epic_dates_ad` are gone, along with the four trigger functions and the audit tables `epic_subboard_migrations` / `_lists` / `_cards` and the `rollback_epic_subboard_migration()` function.
- Column `boards._migrated_from_epic_id` is dropped.

**Code**
- `CardType` Zod enum: `["story", "task", "subtask", "bug"]`.
- `lib/rules/types.ts` `set_type` rule action: same union, no `"epic"`.
- `actions/cards.ts` no longer carries the `if (parsed.type === "epic") throw …` branch.
- `lib/queries/workspaces.ts` no longer exports `EpicTile` or `listEpicsInWorkspace`. The workspace boards page (`app/(app)/w/[workspaceId]/boards/page.tsx`) doesn't call them, and `<BoardGrid>` doesn't render epic tiles.
- `lib/roadmap/layout.ts` exports `groupBySubBoard(cards, subBoards)` in place of `groupByEpic(cards)`. `Lane.kind` literal is `"sub_board" | "uncategorized" | "assignee" | "component"`.
- `components/roadmap/roadmap-view.tsx`, `roadmap-header.tsx`, `roadmap-list-view.tsx`, `roadmap-filter-bar.tsx`, `use-roadmap-drag-harness.ts`, and `components/me/me-timeline-view.tsx` consume the new lane primitive. The URL lane mode is `"sub_board"` (default); old `"epic"` URLs no longer match — graceful fallback to default. The drag harness's internal state field renames `epicId` → `laneAnchorId`.
- `lib/board-filters.ts`, `components/board/board-filter-bar.tsx`, `components/dashboard/gadgets/gadget-cards-by-type.tsx` no longer list `"epic"` in their type arrays.
- `scripts/seeds/aiwepi.mjs` builds the AIWEPI fixture as **anchor card on parent board → sub-board linked via `parent_card_id`** instead of `type='epic'` overview cards. WP titles are full ("WP1.1 — Scenario Analysis…"), not `"WPx.y Overview"`.

**Observable in the running app**
- Type pickers in the new-card dialog, quick-add dialog, board filter bar, and roadmap filter bar show: Task / Subtask / Bug (and Story where currently shown). No "Epic" entry anywhere.
- The roadmap default lane mode is "By sub-board" (renamed from "By epic"). Lanes are anchored on the cards that have a sub-board attached. Drilling into a lane header still opens the sub-board.
- The workspace `/w/[id]/boards` page no longer shows the "Epic boards" tiles strip.
- The AIWEPI workspace, re-seeded after 0106, renders 5 lanes named "WP1.1 — Scenario Analysis…" through "WP1.5 — Final Demonstrator…", each pointing at a real sub-board.

### Must not change

- **Sub-boards produced by the original 0100 migration must continue to render.** They already have `parent_board_id`; 0106 just adds `parent_card_id` on top. Member access, list contents, card placement inside those sub-boards stay identical.
- **The four remaining card types** (Story / Task / Subtask / Bug) keep their existing behavior on create, update, move, delete, assign, and due-date. The "type is locked after creation" UX (TB-04) is unchanged.
- **Permissions.** Workspace-member-can't-create-board (TB-46), board-admin gates, and RLS rules on `cards` / `boards` are untouched. The migration is forward-only DDL only; no policy is rewritten.
- **The roadmap's other two lane modes** — "By assignee" and "By component" — keep their current semantics. The only edit to their grouping functions is removing the now-unnecessary `c.type === "epic"` skip; subtasks are still skipped.
- **Subtask rendering** in the roadmap (the `subtaskRowsByParent` nesting under expanded parents) is unchanged. Subtask cards still belong to their parent task, render as subtask bars under it, and don't get their own top-level row.
- **Milestones** (migration 0095) and the milestone-pinning UI are not in scope. The AIWEPI seeder continues to seed 5 milestones via the `milestones` table.
- **Existing realtime channels and the board-snapshot shape** stay backward-compatible. The snapshot already exposes `cardSubboards` (from the 0105 work); we read from that field, we don't reshape it.
- **The `+1 UNDATED` collapsed-counter** on lane rows and the lane-row card count both stay accurate after the regroup — they're a function of `lane.cards` length, which the new `groupBySubBoard` populates identically.

---

## Decompose

Units in dependency order, each landing as its own commit. Write-sets listed so future passes can see overlap.

| #   | Unit                                    | Write-set                                                                                                                                                                                            | Depends on |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Migration 0106                          | `supabase/migrations/0106_drop_epic_type.sql`                                                                                                                                                        | —          |
| 2   | Drizzle schema drop                     | `lib/db/schema.ts` (`boards.migratedFromEpicId` declaration removed)                                                                                                                                 | 1          |
| 3   | Validation + rules enum                 | `lib/validation.ts` (`CardType`), `lib/rules/types.ts` (`set_type`)                                                                                                                                  | —          |
| 4   | Runtime guard                           | `actions/cards.ts` (drop epic-rejection branch + tighten local annotation)                                                                                                                           | 3          |
| 5   | Workspace queries + boards page         | `lib/queries/workspaces.ts`, `app/(app)/w/[workspaceId]/boards/page.tsx`, `components/workspace/board-grid.tsx`                                                                                      | —          |
| 6   | Roadmap layout core (`groupBySubBoard`) | `lib/roadmap/layout.ts`, `tests/unit/roadmap-layout.test.ts`                                                                                                                                         | —          |
| 7   | Roadmap view wiring                     | `components/roadmap/roadmap-view.tsx`, `components/roadmap/roadmap-header.tsx`                                                                                                                       | 6          |
| 8   | Drag-harness rename                     | `components/roadmap/use-roadmap-drag-harness.ts`                                                                                                                                                     | 7          |
| 9   | Roadmap list/me-timeline depth-0 key    | `components/roadmap/roadmap-list-view.tsx`, `components/me/me-timeline-view.tsx`                                                                                                                     | 7          |
| 10  | Filter bars + dashboard gadget          | `lib/board-filters.ts`, `components/board/board-filter-bar.tsx`, `components/roadmap/roadmap-filter-bar.tsx`, `components/dashboard/gadgets/gadget-cards-by-type.tsx`                                 | 3          |
| 11  | AIWEPI seeder                           | `scripts/seeds/aiwepi.mjs`                                                                                                                                                                           | 1          |
| 12  | Test alignment                          | `tests/integration/card-types.test.ts`, `tests/integration/seed-demo.test.ts`, `tests/unit/epic_migration_ui.test.ts` (delete or keep), `tests/e2e/gantt-drag-first.spec.ts`, jira e2e comment fixes | 3, 6, 7    |

**Parallel-safe groups** (verified by inspection of write-sets):
- After Unit 1 lands: Units 2, 3, 5, 6, 11 share no files → can dispatch in parallel.
- After Unit 6 lands: Units 7 and 10 share no files → parallel-safe. (Unit 7 modifies `roadmap-view.tsx` and `roadmap-header.tsx`; Unit 10 modifies the filter-bar files.)
- After Unit 7 lands: Units 8 and 9 share no files → parallel-safe.
- Unit 12 is sequenced last because some assertions depend on Unit 6's new `groupBySubBoard` signature and Unit 3's new `CardType` shape.

**Parallelism cap.** The verify step for each unit includes a manual browser check on at least one surface. Don't dispatch more units in parallel than you can personally re-open in the browser. In practice that means: max 2 parallel units in the layout/UI batch (Unit 7 + Unit 10), max 3 in the early batch (Units 2 + 3 + 5).

### Pre-conditions for verification

Before any unit dispatches, these must exist or be confirmed:

1. **A pre-existing tripwire suite.** The current Vitest unit suite (160 tests passing per your prior summary) plus the e2e set is the tripwire. Confirm `npx vitest run tests/unit` is green on the current `HEAD` before starting — no point measuring drift against a broken baseline.
2. **Local Supabase running** with the schema at migration 0105 (the last one applied). Confirm: `supabase status` shows `supabase_db` healthy and `supabase migration list` shows 0105 applied and 0106 NOT applied.
3. **Re-seedable AIWEPI fixture.** The seeder file `scripts/seeds/aiwepi.mjs` and runner `./scripts/seeds/run.sh` exist (they do as of `bf053b3`). `SEED_RESET=true` works without edits to the env discovery code path.
4. **Named test user.** `team@innovina.it` exists in `auth.users` of the local DB. Verify: `psql … -c "select email from auth.users where email = 'team@innovina.it'"` returns one row.
5. **Browser tooling.** Playwright MCP is connected so the cold-observer pass (Verify step 3 below) can drive the running app without you re-clicking by hand.

If any of 1–5 fails, fix it **before** dispatching Unit 1 — those are dependencies for Verify, not for Build.

---

## Build

Per-unit commits, each with a clear message and a write-set that matches the table above. The companion plan file (`docs/superpowers/plans/2026-05-18-remove-epic-type.md`) has the exact code for each step, including before/after snippets, the failing-test-first sequence for Unit 6, and the verification commands.

**Build choices made explicit:**

- **`groupBySubBoard` is a replacement, not an additional grouping mode.** The temptation is to keep `groupByEpic` for "legacy compatibility" and add `groupBySubBoard` alongside. That's premature reusability — there's exactly one consumer of the lane primitive and exactly one shape we want it to take. Add the second function only on the *second* use case.
- **Migration 0106 is idempotent.** `update … where parent_card_id is null` so re-runs don't clobber Task 5's earlier work on rows already updated by hand. The check-constraint replacement runs *after* the demote `UPDATE`, so a partial replay never hits a constraint-violation state. Every `drop … if exists`.
- **Audit tables get dropped.** Migration 0100's `epic_subboard_migrations` / `_lists` / `_cards` were forensic and one-shot. Their content is reproducible from `git log` against migration 0100 if ever needed. Keeping them indefinitely is process inflation (see "When the system fails").
- **No new abstraction layer for the new lane primitive.** `groupBySubBoard` is one function, called from one place, that takes the data it needs as a second argument (`subBoards`). No "lane provider hook," no "lane registry." Reusability is a Harvest concern.
- **Per-unit commit messages match the unit table.** When something breaks at Unit 9, `git log --oneline` already points at Unit 9 specifically. Don't squash; the per-unit attribution is the point.

---

## Verify

Two layers, three observers — as specified in the system doc. The companion plan file's per-task "Step N: Run …" lines are the **agent layer**; this section is the human layer.

### Tripwire layer — independent of any change

These tests must be green before Unit 1 starts AND after every unit lands. The set is fixed; an agent-authored test specifically for epic removal is not part of the tripwire (it's a per-unit deliverable, not an independent guard).

| #   | Tripwire                                                                | Why it's load-bearing                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | `npx vitest run tests/unit` is green                                    | 160 unit tests cover the layout primitives, the validation enums, the rule engine, the snapshot reducer, and the store mutators. If this drifts, the agent has touched something it didn't announce. |
| T2  | `npx vitest run tests/integration` is green                             | Hits Supabase. Covers RLS, action layer, snapshot composition, sub-board creation — the seams most likely to break silently when an enum disappears.                                                 |
| T3  | `npm run build` succeeds                                                | The only check that catches "internally consistent code that fails to actually start." Run after Unit 4 and after Unit 7 at minimum; cheap enough to run every unit.                                 |
| T4  | `npx tsc --noEmit` clean                                                | Catches the kind of import/type drift the agent doesn't surface in its own report.                                                                                                                   |
| T5  | `npm run lint` produces the same 3 pre-existing warnings, zero errors   | If the warning count grows, the agent left dead-code or unused imports behind.                                                                                                                       |
| T6  | The AIWEPI workspace renders, after re-seed, with all 5 lanes visible   | This is the load-bearing real-artifact check. If after a unit lands and the seed is re-run the roadmap is blank, the lane primitive is broken in a way unit tests can't catch.                       |
| T7  | The Subtask creation flow on any board still creates a subtask card     | TB-04 / TB-05 are upstream of every type-touching change; this is the proof that the enum shrink didn't quietly break valid types.                                                                   |

T1–T5 are mechanical, run them via the agent after each unit. T6 and T7 require a browser; run them at the unit boundaries called out below.

### Per-unit verification — written from "Must not change"

Each `Must not change` bullet from the Spec becomes an executable check at some unit. Mapping:

| Unit  | Must-not-change item being checked here                              | Check                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Sub-boards from 0100 continue to render; FK semantics preserved      | Apply migration in a transaction to a copy of prod-like data first; query `select count(*) from boards where parent_card_id is null and _migrated_from_epic_id is null` post-apply. |
| 1     | Zero `type='epic'` rows after demote                                 | `select count(*) from cards where type = 'epic'` → 0.                                                                                                                                |
| 3, 10 | Four card types still selectable in pickers                          | Open new-card dialog on AIWEPI workspace; confirm picker shows Task / Subtask / Bug only. Story is hidden by design (Sheet1 1b).                                                      |
| 6     | Subtask rendering under expanded parents unchanged                   | The `groupByAssignee` and `groupByComponent` skip-subtask tests stay; explicitly assert subtask still nests in the new `groupBySubBoard` test.                                       |
| 7     | URL lane-mode parameter gracefully falls back                        | Manually visit `/w/<id>?lanes=epic` after Unit 7 — the URL parser should not throw; the default lane mode renders.                                                                   |
| 7     | "By sub-board" is the default lane mode                              | Open the workspace roadmap with no `?lanes=` query — confirm the header chip reads "By sub-board".                                                                                   |
| 9     | List-view + me-timeline hierarchy still works                        | Switch to list view in the roadmap; confirm anchor cards render with bold/font-medium and children render indented.                                                                  |
| 11    | AIWEPI seeder produces a renderable fixture                          | `SEED_RESET=true ./scripts/seeds/run.sh aiwepi`; visit `/w/<workspaceId>` → 5 lanes with full WP titles, tasks under each, deliverables nested under tasks (expand to verify).        |
| 12    | The "rejects retired epic type" assertion still fails for an `epic` input | Switch the assertion from "action throws" to "Zod parse fails" but keep its intent — the type is rejected somewhere.                                                                  |

### Three independent observers

The blast radius justifies three observers. They look at different aspects on the *same running app*, not the same aspect on three rigs.

1. **The agent (or automation) — golden path of each unit.**
   The companion plan's `Step N: Run …` lines, run by the agent dispatched per unit. Covers the in-scope path of the change. Cheap, exhaustive on breadth. This includes typecheck, lint, the per-unit unit tests, and the migration's syntactic check.

2. **You — blast-radius walk.**
   At the unit-boundary points called out below, you open the app yourself and exercise the "Must not change" list, the seams near the change, and anything that smelled off when reviewing the diff. Specifically:
   - After Unit 1 lands and migrates: open the previously-existing AIWEPI workspace (pre-re-seed). The original `_migrated_from_epic_id`-tagged sub-boards should now have populated `parent_card_id` AND their member access / card placement / list contents should be unchanged.
   - After Unit 6 lands: open the workspace roadmap with the new `groupBySubBoard`. Confirm lane rendering for the existing AIWEPI fixture is recognizable (lanes match sub-boards 1:1, header cards match anchor cards).
   - After Unit 11 lands and re-seeds: scan the roadmap visually for the issues you flagged earlier in this thread — lane titles, T2.x under WP1.2, deliverable visibility on expand. Confirm what changed and what intentionally didn't.

3. **A cold observer — first use without context.**
   The cold pass is best run *after Unit 12 lands and the branch is otherwise green*. Two options:
   - **Coworker / fresh self.** Hand them the workspace URL. Ask them to "create a card and pick a type" without explaining anything. They should not ask "where's epic?" — the picker shouldn't suggest the option is missing.
   - **Playwright MCP-driven walk.** Drive the app from a fresh session: create a new workspace, create a board, open the new-card dialog, enumerate the type options programmatically, navigate to the roadmap, switch lane modes, confirm "By sub-board" appears. The MCP run sees only what the rendered DOM says, which is the closest proxy to "uses the result without knowing what was changed."

The cold observer is **not the agent that wrote the unit**. If the same agent that built Unit 6 is also the one walking the app post-Unit-12, that's one observer in three hats, not three observers.

### Real-artifact discipline

Per the system doc: typecheck, lint, and unit tests don't ask "does the thing run?" The mandatory real-artifact gates for this change are:

- **After Unit 1**: `supabase migration up` applied to a local DB, then `psql` queries confirm the new check constraint is in place and no epic rows remain. Not "the migration's SQL looks right" — the migration actually ran and the state is what we expected.
- **After Unit 6**: `npx vitest run tests/unit/roadmap-layout.test.ts` PASSES with the new test setup. The unit test exercises the pure function with realistic fixtures — that's the smallest real-artifact run for the layout primitive.
- **After Unit 7**: the dev server starts (`npm run dev`), the workspace roadmap loads without console errors, and switching lane modes via the picker doesn't 500. This is the cheapest broad check that the wiring is real.
- **After Unit 11**: the AIWEPI seed reset runs end-to-end and the rendered page matches the description in the "Done looks like" section.
- **Before merging**: a full Playwright MCP walk through the create-card and roadmap-view flows on a fresh seed. This is the cold observer's pass; it covers what neither you nor the agent thought to check.

---

## Harvest

After the unit lands and works, three questions:

### What's reusable?

Candidates surfaced by this change:
- **Lane primitive shape.** `Lane<C>` now has four `kind` values. If a fourth lane mode is ever added (e.g., "By status"), the right time to extract a shared `LaneBuilder` interface is when the *second* alternate lane mode is being written, not now. Note this in `lib/roadmap/layout.ts` if useful, but don't extract.
- **Sub-board lookup helper.** `subBoardByAnchor` and `subBoardById` are built ad-hoc inside `groupBySubBoard`. If the roadmap-list-view or me-timeline-view ends up needing the same lookup (it does — see Unit 9), extract a small `indexSubBoards(subBoards)` helper. **Decide after Unit 9 lands, not before.**
- **Migration audit pattern.** 0100 created three audit tables and a rollback function; 0106 drops them. If a future migration of similar blast radius is planned, the harvest is: audit tables are useful *during the migration window*, but they need an explicit drop step in the next migration to avoid permanent clutter. Note this in your migration-writing playbook.

### What did the process miss?

To be filled in at the end of execution. The candidates to watch for:
- Did the AIWEPI seed reset surface a bug the unit tests didn't catch? → A new tripwire entry: a vitest integration test that drives the seeder end-to-end and asserts the snapshot shape.
- Did the URL lane-mode rename (`epic` → `sub_board`) silently break a bookmarked URL? → A new "Must not change" line for the next URL-touching change.
- Did the migration's idempotency guard get exercised, or did we get lucky on the first run? → If lucky, write a focused integration test that runs 0106 twice and asserts equivalence.

### What gets fed back into the spec?

The system doc's rule: each loop leaves protection behind. From this change, add to the running spec library:
- **A "no orphan enum values" tripwire**: a vitest test that asserts `CardType.options` and the DB `cards_type_check` constraint resolve to the same set. If a future migration drops a type but a code value lingers (or vice versa), this catches it.
- **A "lane primitive consumer count" tripwire**: a grep-based test that asserts the number of files importing `lib/roadmap/layout.ts` doesn't exceed N (current value + tolerance). Catches accidental fan-out of the lane primitive — the kind of premature reusability this Build deliberately avoided.
- **A "must-not-change" entry for the next roadmap-touching change**: "URL `?lanes=` parameter values from the previous shape must gracefully fall back to default — never throw, never 500." Captured during Unit 7's verification.

---

## When the system fails (escape hatches)

If a unit's verify pass fails:

1. **Don't add more process.** Don't write a new phase, don't add another checklist.
2. **Locate the miss in the loop.** Which phase missed it?
   - Spec didn't name the invariant → add a "Must not change" line and re-run that unit's verify.
   - Decompose missed a dependency → push the unit back into the queue with the corrected dependency edge; don't dispatch in parallel anymore.
   - Build produced something that doesn't match the spec → reject and re-dispatch with a sharper spec, not with a longer prompt.
   - Verify ran against the wrong artifact (e.g., `tsc` passed but the dev server crashed) → upgrade the verify step *for this unit only* to include the real-artifact check that would have caught it; don't retro-fit it to every unit.
3. **Add the smallest mechanism** that would have caught it. One new tripwire row, one new "Must not change" pattern, one new prompt template fragment. Then move on.

The loop is supposed to compound, not inflate. If at the end of this change the tripwire layer has gained two rows and the spec library has gained two patterns, that's healthy. If it has gained ten new "process rules," something has gone wrong and the next reviewer will silently ignore them.

---

## How to actually do this (operational order)

1. Read the companion plan: [`docs/superpowers/plans/2026-05-18-remove-epic-type.md`](../plans/2026-05-18-remove-epic-type.md).
2. Confirm the five pre-conditions in the **Decompose → Pre-conditions for verification** section above.
3. Pick execution mode: subagent-driven (recommended) or inline-with-checkpoints.
4. Dispatch units in dependency order. For each unit:
   - Build (agent)
   - Per-unit verify (commands in the plan)
   - Tripwire pass (T1–T5 every unit; T6/T7 at the unit boundaries called out)
   - Your blast-radius walk at Unit 1, 6, 11 boundaries.
   - Per-unit commit, with the message from the plan.
5. After Unit 12: cold-observer pass (Playwright MCP or coworker).
6. Run the Harvest section. Capture what to feed back.
7. Open the PR; the description should be the "Done looks like" section verbatim, the migration's SQL, and a link back to this spec.
