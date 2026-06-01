# Test Plan — Roadmap completion ↔ board "done" sync

**Feature commit:** `5092c37` + migration `0114` (`f10ba48`)
**Under test:** `setRoadmapCompletionImpl` / `setRoadmapCompletion` (`actions/cards.ts`), roadmap bar toggle (`components/roadmap/roadmap-bar.tsx`), column `cards.pre_done_list_id`.

## 1. Feature contract (what we are verifying)

1. Ticking complete on the roadmap stamps `completed_at` AND moves the card to the board's `done` list.
2. If the board has no `done` list, one is created.
3. The list the card was in before the auto-move is saved in `cards.pre_done_list_id`.
4. Un-ticking clears `completed_at` + `pre_done_list_id` AND returns the card to the saved prior list.
5. No move when: card already in a `done` list, or the user manually moved it out of `done` after completing.
6. `updateCard` is never used for this; the five board-side completion toggles do NOT move the card (scope guard).
7. Invariants: one `done` list per board (`lists_board_id_status_kind_uq`); `pre_done_list_id` FK is `ON DELETE SET NULL`.

## 2. Test levels & how to run

| Level | Tool | Command | Prereq |
|---|---|---|---|
| Integration (server action) | Vitest | `npx vitest run tests/integration/roadmap-completion.test.ts` | Local Supabase up + `.env.local` |
| Type safety | tsc | `npx tsc --noEmit` | — (known pre-existing error in `workspace-invitations.test.ts`, unrelated) |
| Lint | eslint | `npm run lint` | — |
| Component (optimistic UI) | Vitest + RTL/jsdom | new `tests/ui/roadmap-bar-complete.test.tsx` | mock store + action |
| E2E (full flow) | Playwright | `npm run test:e2e` (after adding spec) | dev server + demo seed |
| Manual / exploratory | browse / app | see §7 | dev server |

Note: do NOT use `npm run test:unit` (all vitest) as the gate — it includes stale integration suites (e.g. `epic-actions`) that fail on the old `seedDefaultLists` setup pattern, unrelated to this feature.

## 3. Integration tests — server action (`tests/integration/roadmap-completion.test.ts`)

Legend: ✅ = implemented (5/5 green today). ➕ = to add.

### 3.1 Core completion / reversion
| ID | Precondition | Action | Expected |
|---|---|---|---|
| INT-01 ✅ | board, `todo` list, card in it | complete | card in `done` list; `pre_done_list_id` = todo list; `completed_at` set |
| INT-02 ✅ | as INT-01, then completed | un-complete | card back in todo list; `pre_done_list_id` null; `completed_at` null |
| INT-03 ✅ | board has NO `done` list | complete | a `done` list is created; card moved there; exactly one `done` list on board |
| INT-04 ✅ | card already in a `done` list | complete | no move; `pre_done_list_id` stays null; `completed_at` set. Then un-complete → stays, `completed_at` null |
| INT-05 ✅ | completed via roadmap, then `moveCardImpl` out of done | un-complete | card stays where moved; `pre_done_list_id` cleared; no yank-back |

### 3.2 Source-list variants
| ID | Precondition | Action | Expected |
|---|---|---|---|
| INT-06 ➕ | card in `in_progress` list | complete then un-complete | complete → done, prior = in_progress; un-complete → returns to in_progress |
| INT-07 ➕ | card in `review` list | complete then un-complete | symmetric to INT-06 |
| INT-08 ➕ | card in `blocked` list | complete then un-complete | symmetric |
| INT-09 ➕ | card in an **unmapped** list (`status_kind` = null) | complete then un-complete | complete → done, prior = unmapped list; un-complete → returns to unmapped list |

### 3.3 Idempotency / cycles
| ID | Precondition | Action | Expected |
|---|---|---|---|
| INT-10 ➕ | card completed via roadmap | complete again | idempotent: stays in done, `pre_done_list_id` unchanged, `completed_at` refreshed-or-stable |
| INT-11 ➕ | card open | un-complete (already open) | no-op: no move, `completed_at` stays null, no error |
| INT-12 ➕ | todo card | complete → un-complete → complete → un-complete | ends in todo each cycle; `pre_done_list_id` correctly re-recorded and re-cleared |

### 3.4 Reversion edge cases
| ID | Precondition | Action | Expected |
|---|---|---|---|
| INT-13 ➕ | completed (prior = todo); delete the todo list | un-complete | FK nulls `pre_done_list_id`; card stays in done; no crash |
| INT-14 ➕ | completed (prior = todo); archive the todo list | un-complete | card returns to the (archived) prior list OR stays — assert the chosen contract; document it |
| INT-15 ➕ | done list has 3 cards; revert a card | un-complete | reverted card appended at END of prior list (position ordering correct) |
| INT-16 ➕ | `setRoadmapCompletion` return value | complete / un-complete | returns `{ cardId, boardId, listId }` with the resulting list; `boardId` correct for revalidatePath |

### 3.5 Side-effects / triggers
| ID | Precondition | Action | Expected |
|---|---|---|---|
| INT-17 ➕ | todo card | complete | `due_complete` mirror (trigger 0062) = true; un-complete → false |
| INT-18 ➕ | todo card | complete | activity log row `card.complete` AND `card.move` emitted; un-complete → `card.uncomplete` (+ `card.move` if reverted) |

## 4. Authorization tests (RLS / roles)

| ID | Actor | Action | Expected |
|---|---|---|---|
| AUTH-01 ➕ | non-member of board | `setRoadmapCompletion` | `ACCESS_DENIED` (probe finds no card / role check fails) |
| AUTH-02 ➕ | workspace **guest** assigned to the card | complete | blocked (`assertNotGuest`, mirrors `updateCard` completion gate) |
| AUTH-03 ➕ | board **member** (non-admin) | complete + un-complete | allowed (lists_member_write covers member) |
| AUTH-04 ➕ | board **admin** | complete + un-complete | allowed |
| AUTH-05 ➕ | workspace-visibility board, workspace member (not board member) | complete | allowed per workspace-visibility policy |
| AUTH-06 ➕ | non-existent `cardId` | complete | `ACCESS_DENIED` |

## 5. Regression / scope-guard tests

The feature must NOT change board-side behavior.

| ID | Surface | Action | Expected |
|---|---|---|---|
| REGR-01 ➕ | card modal complete toggle (`card-modal.tsx`) | toggle complete | sets `completed_at`; card does NOT move lists; `pre_done_list_id` untouched |
| REGR-02 ➕ | card tile toggle (`card-tile.tsx`) | toggle complete | no list move |
| REGR-03 ➕ | complete-toggle component / due section | toggle complete | no list move |
| REGR-04 ➕ | bulk complete (`bulkSetCompleted`) | bulk complete | sets completion; no list move |
| REGR-05 ➕ | `updateCard({ completed })` directly | call | never touches `listId` (invariant #0111 preserved) |
| REGR-06 ➕ | board kanban drag to a `done` list | move card | does NOT auto-set `completed_at` (existing behavior unchanged) |

## 6. Component test — optimistic UI (`tests/ui/roadmap-bar-complete.test.tsx`)

Vitest + jsdom + Testing Library, mocking `@/actions/cards` and the workspace store.
Caveat (project memory): components importing `@/components/ui/button` (base-ui) can fail vitest import-analysis — if `RoadmapBar` is untestable in jsdom, cover this layer via E2E (§7) instead and skip COMP.

| ID | Action | Expected |
|---|---|---|
| COMP-01 ➕ | click complete toggle | `patchCardLocal` called immediately with `completedAt` set (optimistic flip) before await resolves |
| COMP-02 ➕ | action rejects | optimistic patch rolled back; `toast.error` shown |
| COMP-03 ➕ | calls server | `setRoadmapCompletion({ cardId, completed })` invoked (NOT `updateCard`) |

## 7. E2E test — Playwright (`e2e/roadmap-completion.spec.ts`)

Full stack incl. realtime CDC reconciliation. Auth: in-app signup `@innovina.it` with the demo-seed checkbox (no email confirmation locally).

| ID | Flow | Expected |
|---|---|---|
| E2E-01 ➕ | signup+seed → open workspace roadmap → tick complete on an open card | bar shows completed style; navigate to that board → card is in the Done column |
| E2E-02 ➕ | un-tick the same card on the roadmap | bar reverts; board → card back in its original column |
| E2E-03 ➕ | board with no Done list → complete on roadmap | Done list/column created; card lands there |
| E2E-04 ➕ | complete, then on the board drag the card to another column, then un-complete on roadmap | card stays where dragged (no yank-back) |
| E2E-05 ➕ | optimistic + CDC | after click, completed style is immediate; bar fill color (status) updates after CDC without manual refresh |
| E2E-06 ➕ | multi-board roadmap | toggling a card on board A's lane does not affect board B cards |

## 8. Concurrency / realtime (harder; partly manual)

| ID | Scenario | Expected |
|---|---|---|
| CONC-01 ➕ | two rapid complete/un-complete clicks | final DB state consistent (no orphaned `pre_done_list_id`); last write wins |
| CONC-02 ➕ | client A completes on roadmap while client B views the board | client B sees the card move to Done via realtime |
| CONC-03 ➕ | complete while another session drags the same card | no deadlock; ends in a valid single list |

## 9. Coverage matrix (contract → tests)

| Contract (§1) | Covered by |
|---|---|
| 1 complete → done + completed_at | INT-01, INT-06..09, E2E-01 |
| 2 auto-create done list | INT-03, E2E-03 |
| 3 record prior list | INT-01, INT-15 |
| 4 un-complete → prior list, clear | INT-02, INT-12, E2E-02 |
| 5 no move (already done / manual move) | INT-04, INT-05, E2E-04 |
| 6 scope guard (board toggles unchanged) | REGR-01..06 |
| 7 invariants (unique done, FK set null) | INT-03 (unique), INT-13 (FK) |

## 10. Environment & prerequisites

- Local Supabase running (`supabase status`); migrations applied through `0114` (`supabase migration up`, NEVER `db:reset` — it wipes local data).
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Integration suites create throwaway users via the service-role key (isolated; safe vs real data).
- New boards in tests use `createBoardImpl(..., { seedDefaultLists: false })` to control status lists and avoid the `lists_board_id_status_kind_uq` collision.

## 11. Known gaps / risks

- No automated coverage today for optimistic-UI rollback and CDC reconciliation (COMP/E2E are ➕).
- `epic-actions` and other older integration suites fail on the stale `seedDefaultLists` pattern — separate cleanup, not this feature.
- INT-14 (archived prior list) contract is undecided — pick "return to archived list" vs "stay in done" and encode it.
- Multi-tab realtime (CONC-02) is best verified manually until a 2-context Playwright harness exists.

## 12. Suggested priority order

1. INT-06..18 (extend existing integration file — cheapest, highest value).
2. REGR-01..06 (lock the scope guard; prevents regressions in board toggles).
3. AUTH-01..06 (security).
4. E2E-01..04 (real UI/CDC confidence).
5. COMP-01..03 (only if RoadmapBar is jsdom-testable; else fold into E2E).
6. CONC + INT-14 decision.
