# Sheet1 Manual Test Guide

**Purpose**: walk through `Sheet1.html` row-by-row and tick each one as you verify it. Each Sheet1 row points to the concrete Testbed (TB-xx) row(s) in `2026-05-14-traceability-report.md` that prove its claim. No reordering — rows below appear in the same order as Sheet1 (row 27 → 70).

**Legend**:
- `[ ]` row not yet tested
- `[x]` row passed (mark after every linked TB passes)
- `[F]` row failed (note which TB failed in **Notes**)
- `[N/A]` row deferred / out-of-scope (still ticked once you've confirmed the deferral note matches reality)
- ⚠ = a TB row whose original claim was unmeasured / implied-PASS — these are the rows that *really* need your eyes
- 🛑 = row marked **deferred / out of scope** in the impl — nothing to test, only confirm the deferral

**Before you start**: complete the *One-time setup* block in `2026-05-14-traceability-report.md` (db reset, four seed scripts, auth hook for TB-07, `npm run dev`). All `ST-xx` codes referenced below are defined there.

---

## Quick coverage map (one-glance)

| Sheet1 row | Priority | Status (sheet) | TB rows | Coverage |
|---|---|---|---|---|
| 27 | Very High | Closed | (covered by epic-removal: TB-01, TB-02, TB-NUI-1..3) | Indirect |
| 28 | Very High | FIX | **TB-04** | Direct |
| 29 | Very High | FIX | TB-01, TB-02, TB-NUI-1, TB-NUI-2, TB-NUI-19 | Direct + DB |
| 30 | Very High | FIX | — (no TB row) | 🛑 Not mapped |
| 31 | High | Develop | **TB-31** | Direct |
| 32 | High | Breaking | TB-01, TB-02, TB-NUI-1..3, TB-NUI-20 | Direct + deferred sub-board UI |
| 33 | High | FIX | **TB-30** | Direct |
| 34 | High | FIX | **TB-32** | Direct |
| 35 | High | FIX | TB-01 (epic-removal covers it) | Indirect |
| 36 | Medium | FIX | **TB-35** | Direct |
| 37 | Medium | FIX | TB-NUI-15 | 🛑 Deferred |
| 38 | Medium | FIX | **TB-33** | Direct |
| 39 | Medium | FIX | **TB-39** | Direct |
| 40 | Low | FIX | **TB-34** | Direct |
| 41 | Low | FIX | TB-NUI-14 | Pre-existing fix |
| 42 | High | Develop | **TB-36, TB-37, TB-38** | Direct |
| 43 | High | Develop | TB-18, TB-19, TB-NUI-6, TB-NUI-7 | Direct + file inspection |
| 44 | High | Develop | **TB-05, TB-06, TB-07 ⚠, TB-08 ⚠, TB-09, TB-NUI-4** | Direct |
| 45 | High | Develop | **TB-17 ⚠, TB-NUI-5** | Perf + DB |
| 46 | High | Develop | TB-NUI-11 | 🛑 Deferred |
| 47 | Medium | Develop | **TB-24, TB-25** | Direct |
| 48 | Medium | Develop | **TB-26 ⚠, TB-27 ⚠, TB-28, TB-29** | Direct |
| 49 | Low | Develop | TB-NUI-16 | File inspection only |
| 50 | Low | FIX | **TB-40** | Direct |
| 53 | Low | FIX | **TB-12** | Direct |
| 54 | Low | FIX | **TB-41** | Direct |
| 55 | Low | Clarify | **TB-44** | Direct |
| 56 | Medium | Clarify | **TB-42** | Direct |
| 57 | Low | Clarify | **TB-43** | Direct |
| 61 | TBD | Clarify | TB-NUI-15 | 🛑 Deferred |
| 62 | Low | Clarify | **TB-45** | Direct |
| 63 | Low | Clarify | TB-NUI-12 | 🛑 Deferred (no `guest` enum yet) |
| 64 | Medium | Clarify | TB-NUI-12 | 🛑 Deferred |
| 65 | Low | Clarify | TB-NUI-12 | 🛑 Deferred |
| 66 | Medium | Breaking | **TB-13 ⚠, TB-14 ⚠, TB-15 ⚠, TB-16 ⚠, TB-20 ⚠, TB-21, TB-22, TB-23** | Direct |
| 67 | High | Breaking | **TB-10 ⚠, TB-11, TB-47** | Direct |
| 68 | Medium | Breaking | TB-13 ⚠, TB-14 ⚠, TB-15 ⚠, TB-16 ⚠ | Same as row 66 cross-tab block |
| 69 | Medium | Breaking | TB-NUI-10 | 🛑 Deferred (partial via 3b) |
| 70 | Low | Breaking | TB-NUI-12 | 🛑 Deferred |

---

## Row-by-row checklist

### Row 27 — Very High / Closed
> Despite having several epic boards — when creating a task in lane 1 — it is not possible to choose its epic board (default should be the board with the name of the lane).

- [ ] Status: closed by **removing Epic entirely**. Verify by passing the epic-removal block:
  - [ ] **TB-01** — type picker shows only Story / Task / Subtask / Bug (no "Epic"). Start: `ST-BOARD`. Open "Add card" on any list → Type field. Pass: exactly 4 options, no "Epic".
  - [ ] **TB-02** — old `/w/[ws]/e/[ep]` route 404s. Start: `ST-IN`. Navigate to `/w/<Testbed id>/e/anything`. Pass: 404.
  - [ ] **TB-NUI-3** — grep: `git grep -inw -E 'epic|Epic|EPIC'` returns only allowlist files.

**Notes**: ___________________________________________

---

### Row 28 — Very High / FIX
> Opening a task already created, it is possible to change the type Task/BUG/Epic. Inhibit this in edit mode.

- [ ] **TB-04** — type chip locked in edit mode. Start: `ST-BOARD`, open any TB-Big card modal. Hover the type chip → click → Tab + Enter. Pass: tooltip *"Type is fixed at creation"*, chip has `aria-disabled="true"` + `disabled`, no type change.

**Notes**: ___________________________________________

---

### Row 29 — Very High / FIX
> EPIC Tasks cannot be created — error creates multiple tasks (340).

- [ ] Closed by removing Epic. Run epic-removal block again (if not already verified for row 27):
  - [ ] **TB-01** — type picker has no Epic.
  - [ ] **TB-02** — `/e/...` route gone.
  - [ ] **TB-NUI-1** — DB: `select count(*) from boards where _migrated_from_epic_id is not null` matches pre-migration `count(*) from cards where type='epic'`.
  - [ ] **TB-NUI-2** — DB: `select public.rollback_epic_subboard_migration();` restores Epic rows (then re-apply).
  - [ ] **TB-NUI-19** — unit test `tests/unit/epic_migration_ui.test.ts` passes.

**Notes**: ___________________________________________

---

### Row 30 — Very High / FIX
> When creating the task, remove the due date (this in fact coincides with the task end date).

- [ ] 🛑 **No TB row covers this directly.** Manually verify in the new-card dialog: open "Add card" on any list — the form should not show a separate "Due date" picker (only Start / End). If it still does, log as a regression.

**Notes**: ___________________________________________

---

### Row 31 — High / Develop
> A board should have default lists like todo and …

- [ ] **TB-31** — `ST-IN`, workspace home. Create a blank board. Pass: exactly three list columns *Todo*, *In Progress*, *Done* in that order.

**Notes**: ___________________________________________

---

### Row 32 — High / Breaking
> Remove the epic concept and then we can have boards inside of boards.

- [ ] Epic-removal half: TB-01, TB-02, TB-NUI-1, TB-NUI-2, TB-NUI-3 (see rows 27/29).
- [ ] **TB-NUI-20** — sub-board UI not yet shipped. Confirm `git grep parentBoardId components/ app/` returns zero. Mark `[N/A]` until UI lands.

**Notes**: ___________________________________________

---

### Row 33 — High / FIX
> By default a subtask should be assigned to the owner of that task.

- [ ] **TB-30** — `ST-IN`. Open a parent card owned by `testbed@local` → add subtask → leave owner blank → save. Pass: subtask `ownerId === testbed@local id`; row shows testbed avatar.

**Notes**: ___________________________________________

---

### Row 34 — High / FIX
> Cannot click on T1.1 — click goes through as if no story.

- [ ] **TB-32** — `ST-IN` on `TB-Sprint`. Click anywhere on a task row body (not on an inner button). Pass: URL contains `/c/<cardId>`, modal visible.

**Notes**: ___________________________________________

---

### Row 35 — High / FIX
> Creating a new task in an epic board: message ok without board.

- [ ] Closed by removing Epic boards entirely. Re-uses TB-01 and TB-02. Tick after row 27/29 pass.

**Notes**: ___________________________________________

---

### Row 36 — Medium / FIX
> In the backlog menu — cannot change the task's list from "Backlog" to other lists.

- [ ] **TB-35** — `ST-BACKLOG`. Select one backlog card → bulk action menu → *Move to list* → pick target (create a "Doing" list first if needed). Pass: card moves; 2xx response.

**Notes**: ___________________________________________

---

### Row 37 — Medium / FIX
> Empty all the Version Data.

- [ ] 🛑 **TB-NUI-15** — out of scope. Nothing to verify. Mark `[N/A]`.

**Notes**: ___________________________________________

---

### Row 38 — Medium / FIX
> Opening the Story — if type is Task it's not highlighted.

- [ ] **TB-33** — open any TB-Sprint card whose stored type is `task`. Pass: the Task chip has `data-active` (or equivalent) — it's the highlighted one.

**Notes**: ___________________________________________

---

### Row 39 — Medium / FIX
> Roadmap → task details → board (wrong); should go back to Roadmap.

- [ ] **TB-39** — `ST-ROADMAP`, click a roadmap bar → close modal (button or Esc). Pass: URL returns to roadmap path, not a board path.

**Notes**: ___________________________________________

---

### Row 40 — Low / FIX
> In story detail — show list of subtasks instead of "Subtask 0/2".

- [ ] **TB-34** — open a parent card with ≥2 subtasks (create on TB-Sprint if needed). Pass: subtask rows visible (title + status), no standalone `N/M` count element.

**Notes**: ___________________________________________

---

### Row 41 — Low / FIX
> Fix Close button layout.

- [ ] **TB-NUI-14** — already fixed in commit `1b79bc9`. Optional smoke test: open quick-view, observe Close button alignment. Mark `[x]` if no regression.

**Notes**: ___________________________________________

---

### Row 42 — High / Develop
> Date Component — clicking the area opens edit; change so date picker also opens.

- [ ] **TB-36** — open a card modal with a due date section → click the date display text. Pass: picker popover opens (`[data-state="open"]`).
- [ ] **TB-37** — type `15/06/2026` into the date input → blur. Pass: input value reflects the typed string.
- [ ] **TB-38** — focus the display area → Enter (picker opens); close; Space (picker reopens). Pass: both keys open it.

**Notes**: ___________________________________________

---

### Row 43 — High / Develop
> DB layer: Supavisor port 54329, pool 20, bulk archive single UPDATE, sprint date shift batch.

- [ ] **TB-18** ⚠ — `ST-IN` on `TB-Sprint` "In Progress" (100 cards). Select all → Archive in bulk bar. Pass: ONE POST, wall-time click → empty list < 1.5 s.
- [ ] **TB-19** ⚠ — `ST-IN` on sprint `TB-Sprint-100`. Trigger "shift sprint +7 days". Pass: ONE PATCH/POST, < 1.5 s.
- [ ] **TB-NUI-6** — unset `NEXT_PUBLIC_SUPABASE_URL`, `npm run dev` → typed zod error at startup.
- [ ] **TB-NUI-7** — `.env.local.example` documents 5 keys (pool config). File inspection.

**Notes**: ___________________________________________

---

### Row 44 — High / Develop
> Migrations 0056 + 0057, middleware gate, email-label single source.

- [ ] **TB-05** — `ST-OUT`, navigate to `/dashboard`. Pass: 302 → `Location: /login?next=/dashboard`.
- [ ] **TB-06** — `ST-OUT`, `fetch('/api/internal/health')`. Pass: 401 + JSON content-type.
- [ ] **TB-07** ⚠ — only valid after **one-time setup step 3** (hook wired in `supabase/config.toml`). `ST-OUT` on `/signup`, email `outsider@example.com`, submit. Pass: visible error; non-2xx response. If hook not wired, mark `[N/A]` and rely on `tests/unit/security-baseline-sql.test.ts`.
- [ ] **TB-08** ⚠ — re-query fresh board/card ids: `select b.id, c.id from cards c join boards b on b.id=c.board_id where b.title='TB-Big' limit 1`. As `ST-OUTSIDER`, GET `<SUPABASE_URL>/storage/v1/object/card-attachments/<board>/<card>/anything.png` with the outsider's bearer token. Pass: **401 or 403** (NOT 404 — 404 means RLS passed).
- [ ] **TB-09** — `ST-IN`. Compare label text for `card.assigned` across bell / inbox / `/settings/notifications`. Pass: byte-identical across ≥2 of 3.
- [ ] **TB-NUI-4** — `git grep -nE '"card\.assigned"|"board\.member\.added"' -- '*.ts' '*.tsx'` — every match imports from `lib/notifications/email-labels.ts` or is that file itself.

**Notes**: ___________________________________________

---

### Row 45 — High / Develop
> Composite + partial indexes (notifications, card_field_history, activity).

- [ ] **TB-17** ⚠ — `ST-IN` (`testbed@local` has 5000 unread seeded). Open `/inbox` or expand the bell. Pass: first row visible < 250 ms (p95 of 5 opens).
- [ ] **TB-NUI-5** — DB: `\d card_field_history`, `\d activity`, `\d notifications` — confirm covering / partial indexes exist.

**Notes**: ___________________________________________

---

### Row 46 — High / Develop
> Subtask completion workflow (intercept auto-complete, confirmation, bidirectional revert).

- [ ] 🛑 **TB-NUI-11** — out of scope. Mark `[N/A]`.

**Notes**: ___________________________________________

---

### Row 47 — Medium / Develop
> Server-side persistence for user preferences (sidebar, view, density, zoom, filters, sort).

- [ ] **TB-24** — `ST-IN`, sidebar expanded → collapse → wait 2 s (past debounce) → hard reload (F5). Pass: sidebar still collapsed after reload.
- [ ] **TB-25** — `ST-IN`, change density to "compact" → wait past debounce → sign out → sign in fresh incognito as `testbed@local`. Pass: still compact.

Note: TB rows only cover sidebar + density. Roadmap zoom / active tab / filters / sort are persisted by the same store — spot-check at least one extra (e.g. change roadmap zoom → reload → confirm restored).

**Notes**: ___________________________________________

---

### Row 48 — Medium / Develop
> Lazy card history (remove eager fetch, paginate).

- [ ] **TB-26** ⚠ — flip `lazy_card_history=true`, `ST-MULTI-CARDS`. Click a card → modal body visible. Pass: < 250 ms p95 over 10 opens.
- [ ] **TB-27** ⚠ — same modal → click History tab. Pass: first page renders < 400 ms p95 over 10.
- [ ] **TB-28** — flag OFF: `ST-MULTI-CARDS`, network panel. Open modal. Pass: history endpoint fires on modal open, history visible without click.
- [ ] **TB-29** — flag ON: open modal, DO NOT click History. Pass: 0 history GETs. Then click History → exactly 1 request.

**Notes**: ___________________________________________

---

### Row 49 — Low / Develop
> Structured errors (TrinnoError with codes), seeder resilience.

- [ ] **TB-NUI-16** — file inspection only: `lib/errors/structured-error.ts` exists. No user-facing consumer yet — mark `[N/A]` for UI; verify file exists.

**Notes**: ___________________________________________

---

### Row 50 — Low / FIX
> Clicking lane name in Roadmap → 404.

- [ ] **TB-40** — `ST-ROADMAP`. Hover a lane name. Pass: not an `<a>` (no `href`); click does nothing.

**Notes**: ___________________________________________

---

### Row 53 — Low / FIX
> In a shared workspace, new board needs refresh to appear.

- [ ] **TB-12** — `ST-TWO-TABS`: A on workspace home, B on Roadmap. In A create board `TB-12-PROBE`. Pass: B's board selector shows `TB-12-PROBE` within 3 s without reload.

**Notes**: ___________________________________________

---

### Row 54 — Low / FIX
> Reorder lane sometimes throws "rank collision".

- [ ] **TB-41** — `ST-ROADMAP` with ≥5 lanes (assign owners on TB-Sprint cards first if needed; see open-prereqs §5 SQL block). Drag-reorder lanes 3× within 500 ms each. Pass: each mutation 2xx, no error toast.

**Notes**: ___________________________________________

---

### Row 55 — Low / Clarify
> Remove the C shortcut for quick-add.

- [ ] **TB-44** — Note: requirement was reinterpreted as *focus-guarded*, not removed. `ST-BOARD`, click empty area, press `C`. Then click into an open dialog's title input, press `C` again. Pass: first press opens quick-add; second press types literal `c`, quick-add does NOT reopen. If you actually wanted it removed entirely, flag as a scope mismatch.

**Notes**: ___________________________________________

---

### Row 56 — Medium / Clarify
> Add Roadmap badge in mine-filter for hidden cards.

- [ ] **TB-42** — `ST-ROADMAP` with some cards owned by `testbed@local` and some by `testbed-member@local` (run the SQL in open-prereqs §5 if defaults leave owners null). Enable Mine filter. Pass: element matching `/\+\d+ more not shown/` visible.

**Notes**: ___________________________________________

---

### Row 57 — Low / Clarify
> Show unassigned task everywhere.

- [ ] **TB-43** — `ST-ROADMAP`. Clear assignee filters (no Mine, no person). Pass: ≥1 unassigned card row visible in viewport.

**Notes**: ___________________________________________

---

### Row 61 — TBD / Clarify
> Is hidden — out of scope for now.

- [ ] 🛑 **TB-NUI-15** — out of scope. Mark `[N/A]`.

**Notes**: ___________________________________________

---

### Row 62 — Low / Clarify
> Remove labels (Regression, Crash, data-loss, ui-perf) if not needed.

- [ ] **TB-45** — `ST-IN` after fresh seed. Open labels picker on any card. Pass: none of the 4 labels appear (case-insensitive).

**Notes**: ___________________________________________

---

### Row 63 — Low / Clarify
> Guest in shared workspace does not get notifications.

- [ ] 🛑 **TB-NUI-12** — full guest model deferred (no `guest` enum value yet). Behavior surrogate (`ST-MEMBER`) is denied where appropriate (see TB-46). Mark `[N/A]` for notifications until guest role lands.

**Notes**: ___________________________________________

---

### Row 64 — Medium / Clarify
> Guest cannot see shared-workspace info on Home.

- [ ] 🛑 **TB-NUI-12** — deferred. Mark `[N/A]`.

**Notes**: ___________________________________________

---

### Row 65 — Low / Clarify
> Cannot assign guest user to a card in shared workspace.

- [ ] 🛑 **TB-NUI-12** — deferred. Mark `[N/A]`.

Related but partial: **TB-46** — `ST-MEMBER` cannot create boards (Create button hidden/disabled, or create action returns 403). Worth ticking as evidence the gate layer exists.

**Notes**: ___________________________________________

---

### Row 66 — Medium / Breaking
> Board virtualization + cross-tab sync (BroadcastChannel, tabId, 60fps with 500+ cards).

Virtualization:
- [ ] **TB-20** ⚠ — `ST-500`. DevTools → Rendering → FPS meter. Scroll Backlog rapidly 5–10 s. Pass: mean ≥ 55 fps.
- [ ] **TB-21** — `ST-500`. Count DOM children of Backlog column. Pass: `document.querySelectorAll('[data-virtual-item]').length < 50` with 500 logical cards.
- [ ] **TB-22** — flip `virtualized_board=false`, reload `TB-Big`. Pass: ≥500 card rows in DOM.
- [ ] **TB-23** — `ST-500`. Drag card #5 → scroll past index 100 while holding → release. Pass: dragged element stays in DOM throughout.

Cross-tab sync:
- [ ] **TB-13** ⚠ — `ST-TWO-TABS`. Log timestamps in console. Click Sign out in A. Pass: B → `/login` within < 500 ms.
- [ ] **TB-14** ⚠ — Two anonymous `/login` tabs. Sign in successfully in A. Pass: B leaves `/login`.
- [ ] **TB-15** ⚠ — `ST-IN`, network filter `/auth/v1/token?grant_type=refresh_token`. Idle 10+ min OR inject 20 rapid synthetic `storage` events. Pass: ≤ 1 refresh POST.
- [ ] **TB-16** ⚠ — set `NEXT_PUBLIC_AUTH_BROADCAST=false` in `.env.local` then `npm run dev`. `ST-TWO-TABS`, sign out in A. Pass: B does NOT auto-redirect.

**Notes**: ___________________________________________

---

### Row 67 — High / Breaking
> Layout-level fetching + shared client cache + tab nav between Board / Roadmap.

- [ ] **TB-10** ⚠ — flip `shared_workspace_cache_v2=true`. `ST-BOARD`, network panel. Open Board (settle) → toggle Board ↔ Roadmap 10×. Pass: 0 new shared-snapshot GETs across the 10 switches; p95 wall-time per switch < 100 ms; no spinner.
- [ ] **TB-11** — flip `shared_workspace_cache_v2=false`. Same toggle. Pass: at least one shared-query GET on each switch (back-compat).
- [ ] **TB-47** — start with all flags false. Flip `shared_workspace_cache_v2=true` via SQL → reload. Pass: behavior switches from TB-11 mode to TB-10 mode (i.e. the flag actually flips runtime behavior).

**Notes**: ___________________________________________

---

### Row 68 — Medium / Breaking
> Cross-tab Supabase auth sync (storage events + BroadcastChannel + no refresh storms).

Same TB rows as the cross-tab half of row 66 — re-ticking here is fine:
- [ ] **TB-13** ⚠ — logout sync < 500 ms.
- [ ] **TB-14** ⚠ — login sync.
- [ ] **TB-15** ⚠ — ≤ 1 token refresh in the window.
- [ ] **TB-16** ⚠ — kill switch reverts to no-sync.

**Notes**: ___________________________________________

---

### Row 69 — Medium / Breaking
> Centralize Supabase client, update-types script, extract service classes.

- [ ] 🛑 **TB-NUI-10** — out of scope (only partial via 3b). Mark `[N/A]`. Optional: `git grep -n 'createClient.*SERVICE_ROLE_KEY' lib/ actions/` — should be a single shared module if anyone tightened this; if multiple call sites, log the gap.

**Notes**: ___________________________________________

---

### Row 70 — Low / Breaking
> Unified workspace roles via JSONB `capabilities` + `hasCapability(user, ...)`.

- [ ] 🛑 **TB-NUI-12** — only `has-guest-access.ts` helper exists; no live call sites; `workspace_role` enum has no `guest` value. Mark `[N/A]`. **TB-46** can be ticked as evidence the surrogate gate exists (member denied board creation).

**Notes**: ___________________________________________

---

## After you finish

1. Count `[x]` vs `[F]` vs `[N/A]`.
2. The ⚠ rows in §"Row-by-row checklist" are the previously-unmeasured claims — if all of those pass, the impl genuinely cleared its weakest evidence.
3. Open prerequisites still owned by the human (auth hook, fresh seed ids, Chrome driver, TB-15 throttle observation, TB-42 lane owners) are listed at the bottom of `2026-05-14-traceability-report.md`. Re-read before re-running.
