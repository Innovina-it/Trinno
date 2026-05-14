# Sheet1 Execution — Testbed (executable)

**Purpose**: every behavior the traceability claimed, in a form a Chrome-remote-debugging agent can execute and a human can re-run. All previously UNKNOWN preconditions are now resolved or explicitly marked as out-of-app.

**⚠ in the ID column** = the underlying claim was "NOT MEASURED" / "Implied PASS" / a weaker test was substituted (e.g. static SQL parse instead of live signup). Highest-priority rows — the only ones that actually need a real running app to verify a previously-unverified claim.

---

## One-time setup

Run these once before any test:

```bash
# 1. Apply all migrations + seeds (clean DB).
npm run db:reset

# 2. Seed testbed fixtures.
node scripts/seed-testbed-500-card-board.mjs       # board TB-Big with 500 cards
node scripts/seed-testbed-100-card-sprint.mjs      # board TB-Sprint + sprint TB-Sprint-100 (100 cards)
node scripts/seed-testbed-5k-notifications.mjs     # 5000 unread for testbed@local
node scripts/seed-testbed-member.mjs               # testbed-member@local + testbed-outsider@local

# 3. (TB-07 only) Enable the auth Before-User-Created hook in local Supabase.
# Edit supabase/config.toml, uncomment these four lines:
#   [auth.hook.before_user_created]
#   enabled = true
#   uri = "pg-functions://postgres/public/auth_block_external_domains"
# Then: supabase stop && supabase start

# 4. Start the app.
npm run dev
```

**Test users created by seed:**

| Email | Password | Role |
|---|---|---|
| `testbed@local` | `testbed-seed-2026` | workspace owner |
| `testbed-member@local` | `testbed-seed-2026` | workspace member (TB-46 guest surrogate) |
| `testbed-outsider@local` | `testbed-seed-2026` | non-member (TB-08 storage RLS) |

**Workspace**: `Testbed` (UUID resolved at seed-time; query: `select id from workspaces where name='Testbed'`).

**How to flip a workspace flag (SQL — used by ST-FLAG-ON / ST-FLAG-OFF)**:
```sql
-- via docker
docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c \
"update workspaces set feature_flags = jsonb_set(feature_flags, '{<flag_name>}', '<true|false>'::jsonb) where name='Testbed';"
```
Replace `<flag_name>` with one of: `subboards_enabled`, `shared_workspace_cache_v2`, `virtualized_board`, `lazy_card_history`. (Note: the 500-card seed pre-sets `virtualized_board=true`.)

---

## Reusable starting states

| Code | Description |
|---|---|
| ST-OUT | Anonymous browser, no auth cookie. |
| ST-IN | Logged in as `testbed@local` / `testbed-seed-2026`. |
| ST-TWO-TABS | Same user `testbed@local`, two tabs A and B, both on `/dashboard`. |
| ST-BOARD | ST-IN, on board `TB-Big` (`/b/<TB-Big id>`). |
| ST-MULTI-CARDS | ST-IN, on board `TB-Sprint` (≥2 lists possible after creating a second list; the 100-card sprint exists). For tests that need subtasks, manually create one parent + 2 subtasks (~30s) on `TB-Sprint`. |
| ST-BACKLOG | ST-IN, on the workspace `Backlog` view. The `TB-Big` board's "Backlog" list is the source. |
| ST-ROADMAP | ST-IN, on the workspace Roadmap view (`/w/<Testbed id>/roadmap` or equivalent). |
| ST-500 | ST-IN, on board `TB-Big`, with `workspaces.feature_flags.virtualized_board=true` (set by seed). |
| ST-MEMBER | Logged in as `testbed-member@local`. (D0.3 "guest" surrogate; see TB-46.) |
| ST-OUTSIDER | Logged in as `testbed-outsider@local` — exists, NOT a workspace member anywhere. |
| ST-FLAG-OFF | ST-IN, then run the flag-flip SQL above with `false` for the relevant flag. |
| ST-FLAG-ON | ST-IN, then run the flag-flip SQL above with `true` for the relevant flag. |

---

## Testbed

| ID | Source | Change requested | What actually changed | Starting state | Action | Expected result | Pass / fail condition |
|---|---|---|---|---|---|---|---|
| TB-01 | Item 1 (1b) | Epic option removed from new-card type picker. | Type picker enumerates Story / Task / Subtask / Bug only. | ST-BOARD | Click "Add card" on any list → open the Type field of the new-card dialog. | Type dropdown shows exactly Story, Task, Subtask, Bug. No "Epic". | DOM under the type picker: exactly 4 options, none with text "Epic". |
| TB-02 | Item 1 (1b — route delete) | Old `/w/[ws]/e/[ep]` epic page is gone. | Route file deleted. | ST-IN | URL bar: navigate to `/w/<Testbed id>/e/anything`. | Next.js 404 / not-found. | Network: first response is 404. Visual: not-found page content. |
| TB-04 | §"Disable type changes in edit mode" (1b + 6a) | Cards cannot have type changed after creation. | Type chip locked in edit mode with `pointer-events-none` + `aria-disabled` + `disabled` + tooltip "Type is fixed at creation". | ST-BOARD, then open the modal for any TB-Big card. | Hover the type chip → click it → Tab to it + press Enter. | Tooltip "Type is fixed at creation" appears. No type change. | DOM: chip element has `aria-disabled="true"` and `disabled`. Visual: tooltip text exactly "Type is fixed at creation". |
| TB-05 | Item 2 (2) | Unauth `/dashboard/**` → 302 to login. | Middleware gate. | ST-OUT | URL bar: navigate to `/dashboard`. | Lands on `/login?next=/dashboard`. | Network: first response status 302 with `Location: /login?next=/dashboard`. Visual: URL bar matches. |
| TB-06 | Item 2 (2) | Unauth `/api/internal/**` → 401 JSON. | Middleware gate. | ST-OUT | `fetch('/api/internal/health')` via DevTools console or agent fetch. | 401 + JSON body. | Network: response status === 401 and `Content-Type` includes `application/json`. |
| TB-07 ⚠ | Item 2 (2) — only static SQL parse ran originally | Signup with non-allowed domain rejected. | Migration 0056 installs `auth_block_external_domains`; allowed_domains in local DB = `['innovina.it']`. **Hook is NOT wired by default — see one-time setup step 3.** | ST-OUT on `/signup`. Hook enabled per step 3. | Fill signup form: email `outsider@example.com`, any password → submit. | Signup rejected with a visible error. | Visual: error message visible. Network: signup endpoint returns non-2xx. |
| TB-08 ⚠ | Item 2 (2) — only static SQL parse ran originally | Storage RLS denies unauthorized bucket access. | Migration 0057 bucket-scoped policies on `card-attachments`. | ST-OUTSIDER. | Issue an authenticated GET (with outsider's bearer token) to `<SUPABASE_URL>/storage/v1/object/card-attachments/<TB-Big board id>/<TB-Big card #7 id>/anything.png`. Concrete: board `18337d5f-c5ac-45b2-998c-9089e6a36535`, card `4de7aa26-ecb5-4367-a1ae-be06612fcc10`. (Board/card ids will change per seed run — re-query before testing: `select b.id, c.id from cards c join boards b on b.id=c.board_id where b.title='TB-Big' limit 1`.) | Access denied (RLS rejects before any file existence check). | Network: response status is 401 or 403, NOT 404. (404 would mean RLS passed and the object lookup happened — failure.) |
| TB-09 | Item 2 (2 + 10) | Notification email kind labels: single source. | 5 drift sites migrated to import from `lib/notifications/email-labels.ts`. | ST-IN. | Open inbox / notification bell → note label text for kind `card.assigned`. Open `/settings/notifications` → note label text for same kind. | Labels are byte-identical across surfaces for the same kind. | Visual: text strings match exactly across at least two of: bell, inbox, settings page. |
| TB-10 ⚠ | Item 3 (4) — NOT MEASURED | Board↔Roadmap tab switch instant, no network call. | Shared workspace cache. | ST-FLAG-ON for `shared_workspace_cache_v2`, ST-BOARD, network panel open. | Open Board (let settle) → click Roadmap tab → back to Board → repeat 10×. | No new network requests for shared queries. No spinner. | Network: 0 new GETs to shared snapshot endpoints across the 10 switches. Wall-time per switch < 100 ms (p95). |
| TB-11 | Item 3 (4) | Flag OFF → per-page fetches still work. | Back-compat. | ST-FLAG-OFF for `shared_workspace_cache_v2`, ST-BOARD, network panel. | Open Board → open Roadmap. | Each fires its own fetch. | Network: at least one shared-query GET on each tab switch. |
| TB-12 | §"Shared workspace board creation" (8) | New board appears in other selectors without refresh. | Roadmap subscribes to `boards` CDC + invalidates cache. | ST-TWO-TABS — A on workspace home, B on Roadmap. | In A, create board named `TB-12-PROBE`. Watch B. | B's board selector includes `TB-12-PROBE` without reload. | DOM in B: element with text `TB-12-PROBE` appears within 3 s. |
| TB-13 ⚠ | Item 4 (5) — Implied PASS | Cross-tab logout < 500 ms. | `BroadcastChannel('trinno-auth-v1')`, jsdom-only verified. | ST-TWO-TABS, log click timestamp in A's console + redirect timestamp in B's. | In A click Sign out. Watch B. | B redirects to `/login`. | Visual: B URL becomes `/login`. Timing: B redirect happens < 500 ms after A click. |
| TB-14 ⚠ | Item 4 (5) — Implied PASS | Cross-tab login propagates. | `signed-in` event. | Two anonymous tabs A and B on `/login`. | Sign in successfully in A. | B leaves `/login`. | Visual: B URL changes off `/login`. |
| TB-15 ⚠ | Item 4 (5) — fake-timers only | Token refresh ≤ 1 / 50min. | Throttle. | ST-IN, network panel filtering on `/auth/v1/token?grant_type=refresh_token`. | Either: leave tab idle 10+ min OR open DevTools Application → Storage → dispatch synthetic `storage` events 20× rapidly. | Refresh hit at most once. | Network: count of `/auth/v1/token?grant_type=refresh_token` POSTs in the window ≤ 1. |
| TB-16 ⚠ | Item 4 (5) — kill-switch back-compat | Kill switch reverts to no-sync. | `NEXT_PUBLIC_AUTH_BROADCAST=false`. | ST-TWO-TABS, with `NEXT_PUBLIC_AUTH_BROADCAST=false` set in `.env.local` before `npm run dev`. | In A sign out. Watch B. | B does NOT auto-redirect (pre-fix behavior). | Visual: B remains on its current page until manually refreshed. |
| TB-17 ⚠ | Item 5 (3a) — perf surrogate | Inbox query uses new partial index. | Migration 0101. | ST-IN (testbed@local has 5000 unread from seed). | Open `/inbox` (or click the notification bell to expand the inbox). Measure time from click to first inbox row visible. | Inbox renders quickly; visible < 250 ms. | Network: inbox endpoint response time + render < 250 ms (p95 across 5 opens). |
| TB-18 ⚠ | Item 5 (3c) — Unit-only originally | Bulk archive 100 cards < 1.5 s e2e. | Single UPDATE. | ST-IN, on board `TB-Sprint`, "In Progress" list (100 cards). | Select all 100 cards via the bulk-select affordance → click "Archive" in the bulk action bar. Start wall-clock at click, stop when all cards leave the list. | Operation < 1.5 s. | Network: ONE POST to the archive action. Wall-time from click to UI reflecting empty list < 1.5 s. |
| TB-19 ⚠ | Item 5 (3c) — Unit-only originally | Sprint date shift 100 cards < 1.5 s. | Single UPDATE with interval. | ST-IN, on sprint `TB-Sprint-100` (100 cards). | Trigger "shift sprint by +7 days" via the sprint controls. Start wall-clock at click, stop when UI reflects new dates. | Operation < 1.5 s. | Network: ONE PATCH/POST. Wall-time < 1.5 s. |
| TB-20 ⚠ | §"Board virtualization" (9a) — FPS NOT MEASURED | 500-card board scroll ≥ 55 fps. | `@tanstack/react-virtual` wrapper. | ST-500. | DevTools → Rendering → enable FPS meter. Scroll the Backlog list rapidly for 5–10 s. | FPS meter mean ≥ 55. | Visual: FPS meter sustains ≥ 55 across the scroll. |
| TB-21 | §"Board virtualization" (9a) | Flag ON → only window of rows in DOM. | Virtualization. | ST-500. | Open DevTools Elements → count children of the Backlog column. | Card-row count is much less than 500 (~20). | DOM: `document.querySelectorAll('[data-virtual-item]').length` < 50 with 500 logical cards. |
| TB-22 | §"Board virtualization" (9a) | Flag OFF → all rows in DOM. | Back-compat. | ST-FLAG-OFF for `virtualized_board` (flip via SQL above), then reload `/b/<TB-Big id>`. | Same DOM count. | All 500 rows present. | DOM: card-row count ≥ 500 in the Backlog column. |
| TB-23 | §"Board virtualization" (9a) | Dragged card persists when source row scrolls out. | Drag-preservation. | ST-500. | Start dragging card #5 → scroll down past index 100 while holding → release. | Dragged element remains rendered throughout. | DOM during drag: element with the dragged card's id remains in the document regardless of scroll. |
| TB-24 | §"User preferences" (9b) | Sidebar collapse persists across reload. | `user_preferences` upsert. | ST-IN, sidebar expanded. | Collapse sidebar → wait 2 s (past debounce) → hard reload (F5). | Sidebar comes back collapsed. | DOM after reload: sidebar element has the collapsed class/attribute. |
| TB-25 | §"User preferences" (9b) | Prefs sync across sessions. | Server-side store. | ST-IN, change layout density to "compact" → wait past debounce. | Sign out → sign in again in a fresh incognito window as `testbed@local`. | Density still "compact". | Visual: new browser reflects compact density. |
| TB-26 ⚠ | §"Lazy card history" (7) — perf NOT MEASURED | Card modal initial paint < 250 ms. | Lazy split, flag ON. | ST-FLAG-ON for `lazy_card_history`, then ST-MULTI-CARDS. | Click a card to open the modal → measure time from click to modal body visible. | Visible < 250 ms (p95 across 10 opens). | DevTools Performance: click→body-paint < 250 ms (p95). |
| TB-27 ⚠ | §"Lazy card history" (7) — perf NOT MEASURED | Lazy history first 20 rows < 400 ms. | Pagination. | Same as TB-26, modal open. | Click the History tab. | First page renders < 400 ms. | Network: request→response→render < 400 ms (p95 across 10). |
| TB-28 | §"Lazy card history" (7) | Flag OFF → history loads eagerly. | Back-compat. | ST-FLAG-OFF for `lazy_card_history`, ST-MULTI-CARDS, network panel. | Open a card modal. | History request fires immediately, history visible without click. | Network: history endpoint called same tick as modal open. |
| TB-29 | §"Lazy card history" (7) | Flag ON → history not fetched until requested. | Flag-gated lazy. | ST-FLAG-ON for `lazy_card_history`, ST-MULTI-CARDS, network panel. | Open a card modal. Do not click History. | Zero history requests. Then click History → ONE request. | Network: 0 history GETs between modal-open and History-click; exactly 1 after click. |
| TB-30 | §"Default subtask owner" (6b) | New subtask inherits parent's owner. | `actions/cards.ts` subtask path. | ST-IN. Find or create a parent card owned by `testbed@local`. | Open the parent → add a subtask via UI → leave owner blank → save. | New subtask owned by testbed@local. | Network: response payload has `ownerId === <testbed@local user id>`. Visual: subtask row shows testbed@local's avatar. |
| TB-31 | §"Default lists for new boards" (6b) | New board has 3 default lists. | `DEFAULT_LIST_TEMPLATES` + batch insert. | ST-IN, workspace home. | Create a new board using the standard "blank" option (NOT a custom template). Open it. | Board has exactly three lists: Todo, In Progress, Done. | DOM: three list-column elements with header text matching exactly in order. |
| TB-32 | §"T1.1 click falls through" (7) | Clicking task row opens modal. | preventDefault + stopPropagation. | ST-IN, on `TB-Sprint` board (any task card). | Click anywhere on a task row body (not on an inner button). | Modal opens at `/b/.../c/<cardId>`. | URL contains `/c/<cardId>`. Visual: modal is visible. |
| TB-33 | §"Story type Task not highlighted" (7) | Type chip reflects saved type. | `liveCard?.type ?? card.type`. | A card with stored type='task', modal open. (Any TB-Sprint card.) | Inspect the type chip strip. | The Task chip is the active one. | DOM: Task chip has `data-active` (or equivalent active marker). |
| TB-34 | §"Story detail subtask list vs count" (7) | Subtasks rendered as rows, not a count. | Subtask section rendering. | A parent card with ≥2 subtasks. Manually create on TB-Sprint if none exist (~30 s setup). | Open the parent's modal → look at the Subtasks section. | Rows visible (title + status), not just `0/2` count. | DOM: ≥N child elements with subtask title text. No standalone element matching `^\d+/\d+$`. |
| TB-35 | §"Backlog move to list" (6c) | Backlog cards can be moved into a list via bulk menu. | New `moveCardToListImpl`. | ST-BACKLOG (workspace Backlog view; the seed places 500 cards in TB-Big "Backlog" list). | Select one backlog card → open bulk action menu → "Move to list" → pick a target list on the same board (e.g. create a "Doing" list first) → confirm. | Card removed from Backlog, appears in target list. | Visual: card under target list. Network: move action returns 2xx. |
| TB-36 | §"Date component click" (9c) | Clicking date display opens picker. | New `DatePicker`. | ST-IN, open a card modal with a due date section. | Click the date display text. | Picker popover opens. | DOM: picker root visible (`[data-state="open"]` or equivalent). |
| TB-37 | §"Date component" (9c) | Typing updates value. | Same. | Same. | Type `15/06/2026` into the date input → blur. | Value updates. | DOM: input value reflects the typed string after blur. |
| TB-38 | §"Date component" (9c) | Enter/Space opens picker. | Keyboard accessibility. | Same. | Focus display area → press Enter; then close; press Space. | Picker opens both times. | DOM: picker opens after Enter, closes, opens again after Space. |
| TB-39 | §"Roadmap detail return" (8) | Closing card opened from Roadmap returns to Roadmap. | `lib/roadmap/back-nav.ts`. | ST-ROADMAP, ≥1 card visible. | Click a roadmap bar → in the modal click Close (or press Esc). | URL returns to the Roadmap route. | URL is the Roadmap path, not a Board path. |
| TB-40 | §"Lane name 404" (8) | Lane name no longer 404s. | Made non-clickable. | ST-ROADMAP. | Hover and try to click a lane name label. | No navigation. | DOM: lane-name element is not an `<a>` (no `href`); click does not change URL. |
| TB-41 | §"Lane rank collision" (8) | Rapid reorder no collision. | `computeOptimisticRank`. | ST-ROADMAP, ≥5 lanes (assignees/owners on TB-Sprint cards produce lanes — if not 5, manually create cards owned by different users first). | Drag-reorder lanes 3 times within 500 ms each. | No error toast, no failed mutation. | Network: each reorder mutation returns 2xx. Visual: no error toast. |
| TB-42 | §"Mine filter badge" (8) | Mine filter hides → "+N more" badge. | Filter bar enhancement. | ST-ROADMAP. Some TB-Sprint cards owned by `testbed@local`, some owned by `testbed-member@local` (the seed's defaults make all owned by no one — assign explicitly before testing). | Enable Mine filter. | Badge "+N more not shown" appears. | DOM: element with text matching `/\+\d+ more not shown/` is visible. |
| TB-43 | §"Unassigned visibility" (8) | Permissive filters include unassigned. | Centralized filter. | ST-ROADMAP. TB-Sprint has cards with `owner_id IS NULL` by default — confirmed via seed. | Clear all assignee filters (no Mine, no person). | Unassigned cards visible. | DOM: at least one unassigned card row in the roadmap viewport. |
| TB-44 | §"C shortcut" (10 + D0.5) | C opens quick-add on Board, no-op in inputs. | Focus-guarded scope. | ST-BOARD, focus on board background (click an empty area). | Press `C`. Then click into the title field of any open dialog → press `C` again. | First C: quick-add opens. Second C: literal `c` typed. | First press: quick-add element visible. Second press: input value contains `c`, quick-add did NOT re-open. |
| TB-45 | §"Label cleanup" (10) | Regression / Crash / data-loss / ui-perf removed from seed. | `actions/seed.ts` cleanup. | ST-IN in a freshly seeded workspace — operational definition: "after running `npm run db:reset` + the testbed seed scripts above; the `Testbed` workspace counts as freshly seeded". | Open the labels picker on any card. | None of the four labels (Regression, Crash, data-loss, ui-perf) appear. | DOM: no label option with those exact texts (case-insensitive). |
| TB-46 | §"Guest permissions" (10 + D0.3) | Guest cannot create boards. | `has-guest-access.ts` helper exists; UI gate lives in `actions/boards.ts` (only `owner`/`admin` can create). **Note**: the `workspace_role` enum has no `guest` value yet — `member` is the closest behavioral surrogate, and it is also denied. | ST-MEMBER (i.e. logged in as `testbed-member@local`). | Try to open the "Create board" affordance from the workspace home. | Affordance is hidden/disabled, OR the create action returns a permission error. | DOM: create-board button missing or `disabled`. OR Network: attempted create returns 403/4xx with "not allowed" or similar. |
| TB-47 | Hotfix B + downstream | Workspace flag flip changes UI behavior live. | `workspaces.feature_flags` JSONB + helper. | ST-IN with all flags currently false (default). | Run flag-flip SQL above to set `shared_workspace_cache_v2=true` → reload page. | Behavior switches to the flag-ON path (TB-10 conditions). | Combined with TB-10/TB-11: flipping the flag flips the observed behavior. |

---

## Not UI-testable

| ID | Source | Item | How to verify |
|---|---|---|---|
| TB-NUI-1 | Item 1 (1a) — D0.1 | 1:1 Epic→sub-board data lift correctness. | DB: `select count(*) from boards where _migrated_from_epic_id is not null` matches pre-migration `count(*) from cards where type='epic'`. Tested in `tests/unit/subboard-migration.test.ts`. |
| TB-NUI-2 | Item 1 (1a) — rollback function | `rollback_epic_subboard_migration()` restores Epic rows. | DB: `select public.rollback_epic_subboard_migration();` then verify counts. Tested in `tests/unit/subboard-migration.test.ts`. |
| TB-NUI-3 | D0.2 | No Epic references survive outside allowlist. | `git grep -inw -E 'epic\|Epic\|EPIC'` returns only allowlist files. |
| TB-NUI-4 | Item 2 (2 + 10) — email-label single source | No duplicate kind→label map outside `lib/notifications/email-labels.ts`. | `git grep -nE '"card\.assigned"\|"board\.member\.added"' -- '*.ts' '*.tsx'` — every match imports from email-labels or is the file itself. |
| TB-NUI-5 | Item 5 (3a) — covering indexes | `card_field_history` and `activity` have pre-existing covering indexes. | DB: `\d card_field_history`, `\d activity`. |
| TB-NUI-6 | Item 5 (3b) — zod env validation | Missing env throws typed zod error. | Tested in `tests/unit/supabase-client-env.test.ts`. For live: unset `NEXT_PUBLIC_SUPABASE_URL`, run `npm run dev`, observe startup error. |
| TB-NUI-7 | Item 5 (3b) — pool config | `.env.local.example` documents 5 keys. | File inspection. |
| TB-NUI-8 | Hotfix A | Migration 0097 SQL bug fixed. | `npm run db:reset` runs through 0103 without error. |
| TB-NUI-9 | Hotfix B (DB) | `workspaces.feature_flags jsonb NOT NULL DEFAULT '{}'`. | DB: `\d workspaces`. |
| TB-NUI-10 | §"Tech debt architecture" | Out of scope (partial via 3b only). | Nothing to verify. Formally deferred. |
| TB-NUI-11 | §"Subtask parent completion workflow" | Out of scope. | Nothing to verify. |
| TB-NUI-12 | §"Unified workspace roles" | Only `has-guest-access.ts` exists; full refactor deferred; helper is NOT yet called anywhere. | Read-only: file exists. No live call sites. Full guest UI gating needs a future dispatch (and a `guest` enum value in `workspace_role`). |
| TB-NUI-13 | §"Sub-board creation success feedback" | UI not implemented. | Nothing to verify until "Create sub-board" UI lands. |
| TB-NUI-14 | §"Fix close button layout" | Pre-existing fix (commit `1b79bc9`). | Optionally smoke-test: open quick-view, observe Close button alignment. Not regressed. |
| TB-NUI-15 | §"Hidden Sprint" / "Empty Version Data" (D0.4) | Out of scope. | Nothing to verify. |
| TB-NUI-16 | §"Structured errors" (10) | `lib/errors/structured-error.ts` exists; no user-facing consumer yet. | File inspection. |
| TB-NUI-17 | §"db-indexes test param cast" (orchestrator) | Test now passes. | `npx vitest run tests/integration/db-indexes.test.ts`. |
| TB-NUI-18 | Migrations 0056/0057/0097/0099–0103 | Files exist and apply in order. | Same as TB-NUI-8 + `ls supabase/migrations/`. |
| TB-NUI-19 | TB-03 (originally) — legacy `type='epic'` card | Post-migration none exist. Behavior covered by `tests/unit/epic_migration_ui.test.ts`. | Unit test only. Not worth manually injecting an Epic row to test the fallback. |
| TB-NUI-20 | TB-48 (originally) — sub-board UI surface | No `parentBoardId` / sub-board UI exists yet in `components/` or `app/`. | Grep confirms zero references. Move on when the UI lands. |

---

## Open prerequisites still owned by the human

These cannot be fully automated:

1. **TB-07 — local Supabase hook wiring**: edit `supabase/config.toml` per one-time setup step 3, then `supabase stop && supabase start`. If you skip this, TB-07 cannot pass live — falls back to coverage by `tests/unit/security-baseline-sql.test.ts` only.
2. **TB-08 — fresh board/card ids per seed run**: if you re-run the 500-card seed, board/card UUIDs change. Re-query (`select b.id, c.id from cards c join boards b on b.id=c.board_id where b.title='TB-Big' limit 1`) before testing TB-08 and update the URL.
3. **Chrome driver**: I have no Chrome/CDP MCP loaded. To have me drive the tests directly: either `npm i -g playwright` then I write a script per row, or install a Chrome MCP server (e.g. `puppeteer-mcp-server`) and add to `.mcp.json`. Otherwise: you (or your Chrome agent) run the rows from this table by hand.
4. **TB-15 throttle**: requires either a 10-minute idle observation or DevTools storage-event injection. Not automation-trivial. Can be skipped if you trust the fake-timer unit test.
5. **TB-42 lane data**: roadmap "lanes" group by owner. Default 100-card sprint seed leaves owner null. Before running TB-41 / TB-42, assign owners on at least 5 sprint cards via UI or:

```sql
docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c \
"with u as (select id from auth.users where email='testbed@local'),
      m as (select id from auth.users where email='testbed-member@local'),
      o as (select id from auth.users where email='testbed-outsider@local')
 update cards
    set owner_id = case (row_number() over () % 3) when 0 then (select id from u) when 1 then (select id from m) else (select id from o) end
  where sprint_id in (select id from sprints where name='TB-Sprint-100');"
```
