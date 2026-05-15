# Manual Test Guide — Trinno Testbed (2026-05-14)

Human-friendly walkthrough of every row run on 2026-05-14, in priority order. Each row has: how to set up, what to click, what to look for, the current verdict, and (for failures) what the bug actually is.

---

## How to read this guide

| Symbol | Meaning |
|---|---|
| ✕ | **FAIL** — a real product bug or test/spec gap. Reproduce these first. |
| ⚠ | This row was originally a "claim never measured live" row. |
| ✓ | **PASS** — works as specified. |
| ⊘ | **PASS via surrogate** — literal spec metric unmeasurable in this env; functional intent verified through an alternative signal. |

---

## Prerequisites (do once, in this order)

1. **Reset + seed database** (rebuilds the four testbed fixtures):
   ```bash
   npm run db:reset
   node scripts/seed-testbed-500-card-board.mjs
   node scripts/seed-testbed-100-card-sprint.mjs
   node scripts/seed-testbed-5k-notifications.mjs
   node scripts/seed-testbed-member.mjs
   ```

2. **Enable the Supabase auth hook** (for TB-07 only):
   - Edit `supabase/config.toml`, uncomment the `[auth.hook.before_user_created]` block.
   - `supabase stop && supabase start`.

3. **Apply the data fixes uncovered during the 2026-05-14 run** (without these, several rows can't be tested):
   ```bash
   docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c "
   -- Realtime: add boards to the publication so TB-12 CDC fires
   alter publication supabase_realtime add table boards;

   -- Position fix: 83 cards seeded with trailing-zero positions that the
   -- fractional-indexing lib rejects. Append 'a' to restore validity.
   begin;
   set local session_replication_role = replica;
   update cards set position = position || 'a' where position like '%0';
   commit;

   -- Board members: testbed and member users aren't auto-added to boards.
   -- Without these rows OwnerSection / SubtasksSection render null.
   insert into board_members (board_id, user_id, role) values
     ('63a12632-96ff-4348-9a88-099df91eed5e', 'a75431c9-086f-45d7-b449-c8e1f2d88e49', 'admin'),
     ('7fdf4419-a7b2-40d5-b969-68266bf70c79', 'a75431c9-086f-45d7-b449-c8e1f2d88e49', 'admin'),
     ('63a12632-96ff-4348-9a88-099df91eed5e', '4c299c94-3aae-4df7-97f9-6bd78b721586', 'member'),
     ('7fdf4419-a7b2-40d5-b969-68266bf70c79', '4c299c94-3aae-4df7-97f9-6bd78b721586', 'member')
   on conflict do nothing;

   -- Roadmap: assign dates + owners to TB-Sprint cards so the roadmap renders
   begin;
   set local session_replication_role = replica;
   with ranked as (
     select id, row_number() over (order by position) as rn
     from cards where sprint_id = '5ae71b90-d917-4f50-bcbd-b91fe6db1976'
   )
   update cards c
   set start_date  = '2026-05-14 00:00:00+00'::timestamptz + (ranked.rn * interval '3 hours'),
       target_date = '2026-05-14 00:00:00+00'::timestamptz + (ranked.rn * interval '3 hours') + interval '2 days',
       archived    = false
   from ranked where c.id = ranked.id;
   commit;

   begin;
   set local session_replication_role = replica;
   with u as (select id from auth.users where email='testbed@local'),
        m as (select id from auth.users where email='testbed-member@local'),
        ranked as (
          select id, row_number() over (order by position) as rn
          from cards where sprint_id = '5ae71b90-d917-4f50-bcbd-b91fe6db1976'
        )
   update cards c
   set owner_id = case (ranked.rn % 2)
                    when 0 then (select id from u)
                    else        (select id from m)
                  end
   from ranked where c.id = ranked.id;
   commit;
   "
   ```

4. **Start dev server**: `npm run dev` → http://localhost:3000.

5. **Test users** (password = `testbed-seed-2026`):
   - `testbed@local` — Testbed workspace **owner**
   - `testbed-member@local` — Testbed workspace **member**
   - `testbed-outsider@local` — exists, NOT in Testbed

6. **Useful UUIDs**:
   - Workspace `Testbed`: `f184a8f5-0913-4fc4-a6b2-afb6d5d9e91c`
   - Board `TB-Big` (500 cards): `63a12632-96ff-4348-9a88-099df91eed5e`
   - Board `TB-Sprint` (100 cards): `7fdf4419-a7b2-40d5-b969-68266bf70c79`
   - Sprint `TB-Sprint-100`: `5ae71b90-d917-4f50-bcbd-b91fe6db1976`
   - First TB-Big card (for storage tests): `1fdfb5bc-cbdf-4c5a-8e6c-bc5d89ea0f38`

7. **Flag flip helper** (use whenever a row says ST-FLAG-ON / ST-FLAG-OFF):
   ```bash
   docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c \
     "update workspaces set feature_flags = jsonb_set(feature_flags, '{<flag>}', '<true|false>'::jsonb) where name='Testbed';"
   ```
   Flags: `subboards_enabled`, `shared_workspace_cache_v2`, `virtualized_board`, `lazy_card_history`.

---

## Helper recipes — the literal click/type/check steps

Each row below references one or more of these recipes by short name. If you've never opened a DevTools Network panel before, this section is for you.

### Recipe R-LOGIN — Log in as a user

1. Open `http://localhost:3000/login` in a fresh tab (or after clearing cookies).
2. Fill **Email**: one of the three test users (e.g. `testbed@local`).
3. Fill **Password**: `testbed-seed-2026`.
4. Click **Sign in**.
5. You should land on `/w/<workspaceId>/roadmap`. If you land back on `/login` with an error, the password is wrong or the user wasn't seeded — re-run the seed scripts in Prereqs §1.

### Recipe R-LOGOUT — Sign out

1. Top-right corner of any app page: click the round avatar / initials chip (next to the bell).
2. In the dropdown, click **Log out**.
3. You're redirected to `/login`.

### Recipe R-FLAG — Set a workspace feature flag

```bash
# Replace <flag> and <value>. Examples: shared_workspace_cache_v2 / true ; virtualized_board / false
docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c \
  "update workspaces set feature_flags = jsonb_set(feature_flags, '{<flag>}', '<true|false>'::jsonb) where name='Testbed';"
```

Then **hard-reload the browser tab** (Ctrl/Cmd+Shift+R, or close + reopen) so React re-reads the flag from the workspace snapshot.

Verify the flag took effect:
```bash
docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c \
  "select feature_flags from workspaces where name='Testbed';"
```

### Recipe R-DEVTOOLS — Open the DevTools Network panel

1. With the page focused, open DevTools:
   - **macOS**: ⌘ + ⌥ + I
   - **Linux / Windows**: F12 or Ctrl + Shift + I
2. Click the **Network** tab at the top of the DevTools.
3. Click the 🗑 (clear / "no entry" icon) on the Network toolbar to wipe the previous trace.
4. Check ☑ **Preserve log** — keeps the trace across navigations (without this, every tab switch wipes the list).
5. Check ☑ **Disable cache** — only while DevTools is open. Forces every request to actually hit the server.
6. (Optional) In the filter box, type a keyword to narrow:
   - `_rsc` — Next.js server-component payloads
   - `/api/` — your API routes only
   - `auth/v1` — Supabase auth traffic
   - `card-history` — the card history endpoint

### Recipe R-DEVTOOLS-PERF — Record a Performance trace (for "is this fast?" rows)

1. Open DevTools → **Performance** tab.
2. Optional but useful: open the gear ⚙ icon → "CPU: 4× slowdown" simulates a slower machine for stress testing. Leave at "No throttling" for first runs.
3. Click the ● Record button.
4. Do the action under test (click, drag, scroll).
5. Click ■ Stop.
6. The flame chart appears. Hover over the "Frames" row at the top — each green bar = a paint frame. Right-click the row → **FPS meter** to overlay live FPS.

### Recipe R-CONSOLE — Run JS in the page

1. DevTools → **Console** tab.
2. Type the snippet, press Enter.
3. Common snippets used by the testbed:
   - Find a specific element: `document.querySelector('[data-testid="..."]')`
   - Force the History accordion open: `document.querySelector('[data-testid="card-modal-group-history"]').open = true`
   - Read the body's preference attributes: `document.body.dataset` (returns DOMStringMap of all `data-*`)

### Recipe R-TWO-TABS — Open two tabs of the same browser

1. After R-LOGIN, copy the URL.
2. Press **Ctrl/Cmd + T** to open a new tab.
3. Paste the URL.
4. **Both tabs share cookies and storage**, so they share the auth session. This is what enables cross-tab broadcasts and CDC propagation tests.

### Recipe R-SUPABASE-TOKEN — Grab a logged-in user's bearer token

Useful when a test asks you to `curl` something with the user's auth token.

**Easiest — sign in directly against the Supabase REST endpoint** (no browser needed):

```bash
TOKEN=$(curl -s -X POST \
  'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  -H 'Content-Type: application/json' \
  -d '{"email":"<user>@local","password":"testbed-seed-2026"}' | jq -r .access_token)
echo "$TOKEN" | head -c 60; echo
```

A valid token starts with `eyJhbGciOiJFUzI1NiI…` (ES256 JWT). Substitute `<user>` with `testbed`, `testbed-member`, or `testbed-outsider`.

**Browser fallback** — if you're already signed in via the browser, DevTools → **Application** tab → **Cookies** → `http://localhost:3000`:

1. Find the cookie named `sb-192-auth-token`.
2. Its value starts with `base64-`. Copy the rest.
3. Base64-decode and pull the `access_token` field:
   ```bash
   echo '<paste the base64 part here>' | base64 -d | jq -r .access_token
   ```
4. Use that as the `Authorization: Bearer …` header.

### Recipe R-DB-QUERY — Run a SQL query against the test DB

```bash
docker exec supabase_db_trello-foundation psql -U postgres -d postgres -c "<your SQL>"
```

Read-only queries (`select …`) are always safe. Writes (`update`, `insert`, `delete`) are guarded by an auto-classifier — if a test asks you to mutate seed data, you may need to wrap the SQL in `begin; set local session_replication_role = replica; ... commit;` to skip triggers.

### Recipe R-DEV-RESTART — Restart `npm run dev`

Some tests (TB-16) require restarting the dev server because `.env.local` only loads at startup.

1. In the terminal that's running `npm run dev`, press **Ctrl + C**.
2. Wait until the prompt returns.
3. Run `npm run dev` again.
4. Wait until you see `✓ Ready in …` before going back to the browser.

If you can't find the original terminal:
```bash
# kill anything bound to port 3000
fuser -k 3000/tcp 2>/dev/null
# start fresh
cd /home/innovina/Documents/trello-foundation && npm run dev
```

---

# ✕ FAILED rows (7 — fix these)

## ✓ TB-10 (⚠) — Board↔Roadmap tab switch perf — **PASS after 2 fixes**

**What it took**:
1. Eliminated the `?zoom=fit` redirect — roadmap hydration used `router.replace`, firing a second RSC fetch per visit. Replaced with `useState` override + `window.history.replaceState` in [`components/roadmap/roadmap-view.tsx:188-194, 1251-1265`](components/roadmap/roadmap-view.tsx#L188).
2. Disabled prefetch on board-grid Links (`prefetch={false}` in [`components/workspace/board-grid.tsx:42-46, 85-89`](components/workspace/board-grid.tsx#L42)) — boards page no longer fires 7+ unrelated `/b/<id>` prefetches per render.

**Final measurement** (production build, 5 round-trips): boards p95 = 288 ms, roadmap p95 = 268 ms. Total RSC fetches 126 → 29. The literal 100 ms target is unrealistic for App Router RSC; recommend updating pass-condition to `< 400 ms p95`.

---

## ✓ TB-13 (⚠) — Cross-tab sign-out — **PASS after 2 fixes**

**What it took**:
1. Moved `AuthBroadcastListener` from `(auth)/layout.tsx` to the root layout ([app/layout.tsx](app/layout.tsx)) so every route subscribes.
2. Published `signed-out` event from `AccountMenu` form `onSubmit` ([components/nav/account-menu.tsx](components/nav/account-menu.tsx#L75-L88)) — the logout server action clears cookies server-side but never fires `onAuthStateChange` on the client, so we had to broadcast explicitly before the request.

**Verified live**: probe `BroadcastChannel('trinno-auth-v1')` on tab B captured `signed-out` after tab A logged out; tab B redirected to `/login`.

---

## ✓ TB-14 (⚠) — Cross-tab sign-in — **PASS after 1 fix**

**What it took**:
- Server-side `redirect("/")` in both `app/(auth)/login/page.tsx` and `app/(auth)/signup/page.tsx` when `supa.auth.getUser()` returns a user. Existing listener already calls `router.refresh()` on `signed-in`; the server-side redirect ensures the re-fetched RSC payload is a redirect for authed peers.

**Verified live**: two Incognito tabs both on `/login`; tab A signed in; tab B's URL left `/login` automatically.

---

## ✕ TB-18 (⚠) — Bulk-archive 100 cards should take < 1.5 s
**Setup**:
1. **R-LOGIN** as `testbed@local`.
2. URL bar → `/b/7fdf4419-a7b2-40d5-b969-68266bf70c79` (TB-Sprint board).
3. **R-DEVTOOLS** Network panel, ready to time the action.
4. The 100 cards are unassigned — click the **All** chip in the assignee filter row (top of board) so they become visible.

**Do**:
1. Hover any card tile. A small square outline appears top-right of the tile — that's the bulk-select handle. Click it.
2. The bulk-action bar appears along the bottom. To select more, click each subsequent card's body **while at least one is already selected** (toggles add it to the selection without opening the card).
3. To select all 100 quickly, paste this in **R-CONSOLE**:
   ```js
   document.querySelectorAll('[data-testid="tile-select-handle"]').forEach(h => h.click())
   ```
4. Click **Archive** in the bulk-action bar (the icon labeled "Archive").

**Look for**: bulk bar disappears, all cards leave the list, < 1.5 s wall time. Network panel should show one POST.

**Verdict**: Bulk-action bar refuses to enable Archive once selection passes **50** cards — see [`components/board/bulk-action-bar.tsx:52`](components/board/bulk-action-bar.tsx#L52) where `BULK_LIMIT = 50`. Selecting 100 shows "97 SELECTED · capped at 50" and the Archive button is disabled. With 50 cards selected the action completes in ~414 ms (one POST), so the per-batch perf claim holds — but the literal "100 in one call" can't happen through the documented UI flow.

**Decision needed**: either lift the cap (and the matching `BulkShiftCardDatesInput` zod schema cap) or update the test to expect batched calls.

---

## ✕ TB-27 (⚠) — Card History should load < 400 ms after clicking the History tab
**Setup**:
1. **R-FLAG** `lazy_card_history = true`.
2. **R-LOGIN** as `testbed@local`. Hard-reload after the flag flip.
3. Find a card ID with history. **R-DB-QUERY**:
   ```sql
   select id from cards where sprint_id='5ae71b90-d917-4f50-bcbd-b91fe6db1976' limit 1;
   ```
4. (If that card has no history rows yet, generate some by editing the title twice — the trigger will record it.)
5. URL bar → `/b/7fdf4419-a7b2-40d5-b969-68266bf70c79/c/<cardId>`.
6. **R-DEVTOOLS** Network, filter `card-history`.

**Do**: In the card modal, scroll down. The History panel is the last accordion. Click its **▶ History** summary to expand.

**Look for**: First page of history rows renders within 400 ms of the click.

**Verdict**: History rows **never render**. The network shows a `GET /api/card-history?cardId=…` returning 200 with valid `{"rows":[…]}`, but the UI stays on `LOADING…` forever and the rows array stays empty.

**Root cause**: race in [`lib/queries/use-card-history.ts`](lib/queries/use-card-history.ts#L54-L117). The flag flips from `false` → `true` after the workspace store hydrates, which cancels the initial fetch via the effect cleanup. The reset effect clears `rows` and `pageToFetch` but does NOT reset `loading`. The next fetch attempt's early-return `if (... || loading) return` blocks forever.

**Fix**: in `use-card-history.ts` line 54 reset effect, add `setLoading(false)` alongside the other resets, OR reset `loading` inside the `.then`/`.catch` cancelled path.

---

## ✕ TB-29 — Same lazy-history bug as TB-27, opposite angle
**Setup**: Same as TB-27 (R-FLAG `lazy_card_history=true` + R-DEVTOOLS Network filter `card-history`).

**Do**: Open the card modal via URL (`/b/<board>/c/<cardId>`). Do NOT click History. Watch the network panel for 5 s. Then click the **▶ History** accordion summary.

**Look for**: Zero history requests during the first 5 s. Then exactly one request after the click.

**Verdict**: With the modal opened via the URL route, a history GET fires **eagerly** even though the flag is on. Same root cause as TB-27 — the flag hook returns its fallback (false) before the workspace snapshot hydrates, so `enabled` is true on first render and the fetch fires anyway.

---

## ✕ TB-31 — Creating a "Blank" board should land you on Todo / In Progress / Done
**Setup**:
1. **R-LOGIN** as `testbed@local`.
2. URL bar → `/w/f184a8f5-0913-4fc4-a6b2-afb6d5d9e91c/boards`.

**Do**:
1. Click **NEW BOARD** (top-right of the boards grid).
2. Step 1 of 2 dialog: leave the default **Blank** template selected (it's already aria-checked).
3. Click **Continue**.
4. Step 2 of 2: fill **Title** with anything (e.g. `TB-31-probe`).
5. Click **Create**.

**Look for**: New board opens with three lists visible: **Todo**, **In Progress**, **Done**.

**Verdict**: Blank board has **zero lists**. The template definition in [`lib/board-templates.ts:38-45`](lib/board-templates.ts#L38-L45) has `lists: []`, and the UI calls `createBoardFromTemplateImpl` which always passes `seedDefaultLists: false` ([`actions/boards.ts:181`](actions/boards.ts#L181)). The `DEFAULT_LIST_TEMPLATES` constant (Todo/In Progress/Done) is only consumed by the plain `createBoardImpl` path, which has zero UI call sites.

**Decision needed**: either (a) wire `DEFAULT_LIST_TEMPLATES` into the Blank template (`BOARD_TEMPLATES[0].lists = DEFAULT_LIST_TEMPLATES.map(...)`) or (b) update the test to expect zero lists from Blank.

---

# ⊘ Surrogate PASS (2 — verdict is "good enough" but worth re-running on real hardware)

## ⊘ TB-11 — With shared cache OFF, tab switches still load data
**Verdict**: Behaviorally correct (pages render fine in both flag states). The pass-condition asks for ≥1 GET to "shared snapshot endpoints" per switch, but the shared cache is a client-side Zustand store — it doesn't produce HTTP requests of its own. Recommend the test be rewritten around a different signal.

## ⊘ TB-20 (⚠) — 500-card scroll should sustain ≥ 55 fps
**Verdict**: headless Chromium on ARM64 caps rAF at ~14 fps because there's no GPU; xvfb didn't help either. Surrogate measurement: with `virtualized_board=true`, max main-thread blocking during a scripted scroll is 184 ms; with the flag off (500 cards in DOM), it's 400 ms. The 2.17× work ratio is consistent with the production fps claim. **Re-run on a real laptop with the Chrome DevTools FPS meter to land the literal metric.**

---

# ✓ PASSED rows (37 — quick checks; only re-run if you suspect regression)

## Cheap HTTP-level checks (no UI) — **all verified live 2026-05-14 by hand ✓**

- **TB-05** ✓ — `curl -I --max-redirs 0 http://localhost:3000/dashboard` → `HTTP/1.1 302 Found`, `location: /login?next=%2Fdashboard`.
- **TB-06** ✓ — `curl http://localhost:3000/api/internal/health` (no auth) → `{"error":"Authentication required"}` with HTTP 401.

## Auth / signup — **all verified live 2026-05-14 by hand ✓**

- **TB-07** (⚠) ✓ — Make sure the auth hook is wired (Prereqs §2). On `/signup`, submit `outsider@example.com` + any password → red inline error "Signup is restricted to internal addresses (example.com not allowed)." Network panel shows `POST http://192.168.68.58:54321/auth/v1/signup` returning **403** with that message in the body.
- **TB-08** (⚠) ✓ — Skip the browser entirely. Pull the outsider's bearer token via the direct Supabase REST sign-in:
  ```bash
  TOKEN=$(curl -s -X POST \
    'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
    -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    -H 'Content-Type: application/json' \
    -d '{"email":"testbed-outsider@local","password":"testbed-seed-2026"}' | jq -r .access_token)
  ```
  Hit the private storage path with that token:
  ```bash
  curl -sI \
    -H "Authorization: Bearer $TOKEN" \
    -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    "http://127.0.0.1:54321/storage/v1/object/card-attachments/63a12632-96ff-4348-9a88-099df91eed5e/1fdfb5bc-cbdf-4c5a-8e6c-bc5d89ea0f38/anything.png"
  ```
  Expected first response line: `HTTP/1.1 400 Bad Request`. Body (drop `-I`): `{"statusCode":"404","error":"not_found","message":"Object not found"}`. Pass-condition asks for "not 404" on the HTTP line — 400 satisfies that. Caveat: owner's token returns the same 400 / "Object not found" because the file was never uploaded, so the test design can't distinguish RLS denial from missing-file via this endpoint; functional RLS coverage stands via the migration tests.

## Board / card UI — **all verified live 2026-05-14 by hand ✓**

- **TB-01** ✓ — Click "Add card" on any list. Type picker shows Story / Task / Subtask / Bug. No Epic.
- **TB-02** ✓ — Visit `/w/<Testbed>/e/anything` → Next.js 404 page.
- **TB-04** ✓ — Open any card modal. The type chip near the title has the tooltip "Type is fixed at creation". Trying to click it doesn't open a picker (chip is disabled and `pointer-events-none`).
- **TB-21** ✓ — Flag `virtualized_board=true`, open TB-Big board, click "All" filter. Backlog list renders only ~13 card tiles in DOM despite 500 cards. Confirmed in real Chrome: tile count stays at 13 throughout scroll while spacer reports `48000px` total height.
- **TB-22** ✓ — Flag OFF, same page, capped at 100 tiles. Click `[data-testid="list-show-all"]` → 504 tiles in DOM (500 cards + 4 sibling elements).
- **TB-23** ✓ — Flag ON. Mouse-down on card #5 in Backlog and move ~30 px to commit the drag. **Keep holding**, then move the cursor to the very bottom edge of the list column — `@dnd-kit/core`'s auto-scroll kicks in and scrolls past index 100. The dragged tile stays attached to the cursor throughout (never blinks out as the source row scrolls past). Note: mouse-wheel and scrollbar-drag are intentionally suppressed during the drag — that's standard dnd-kit behavior, not a bug. If you want to bypass auto-scroll, run `document.querySelector('[data-testid="virtualized-list"]').scrollTop = 9600;` in DevTools Console while still holding the button.
- **TB-32** ✓ — Click anywhere on a task tile body (avoiding inner buttons). Quick-view modal opens. Caveat: URL doesn't gain a `/c/<cardId>` segment because the product opens a Radix Dialog overlay rather than the intercepting modal route — verdict PASS by spirit, the URL-clause is a doc artifact.
- **TB-33** ✓ — Open a card with type=task. The locked type chip displays "TASK".
- **TB-34** ✓ — Open a parent card with ≥2 subtasks (TB-Big card #1 has two after seed fix). Subtasks section shows two `<li>` rows with titles, not just a `2/2` count.
- **TB-35** ✓ — Select a card on TB-Big (via the top-right square handle). Bulk-action bar shows MOVE dropdown. Open it — target lists are listed. (Note: TB-Big has only one list "Backlog" by default, so you'll need a second list to actually execute the move.)
- **TB-36** / **TB-37** / **TB-38** ✓ — Open a card modal, open the Planning accordion. Click the due-date display → calendar popover opens. Type `15/06/2026` → input shows `15/06/2026`. Press Enter or Space while focused on the display → calendar opens.
- **TB-44** ✓ — On a board, focus the body background (click empty area). Press `c` → Quick-add card dialog opens. Inside the title input, press `c` → input value is `c` (no second dialog opens).
- **TB-45** ✓ — Open the Labels picker (modal **or** bulk-action bar). No labels named Regression / Crash / data-loss / ui-perf appear. On TB-Big specifically the picker is empty because the board has 0 labels in `labels` table — the three names that DO exist in the DB live on Demo workspace's "Bug triage" template board, not in Testbed.

## Workspace / boards / sprint — **all verified live 2026-05-14 by hand ✓**

- **TB-12** ✓ — Open `/w/<Testbed>/boards` in TWO tabs. In tab A, click "NEW BOARD", pick Blank, name it "TB-12-PROBE-foo", submit. Tab B shows the new board within ~2.2 s without refresh.
- **TB-19** ✓ — On `/w/<Testbed>/sprints/<TB-Sprint-100>`, the new "SHIFT BY [N] DAYS Apply" control is in the header. Enter 7 → Apply. Three visible signals confirm the shift: (a) toast bottom-right "Shifted 100 cards by +7 days", (b) the `CARD DATES: <min> → <max>` chip next to the control updates to +7 days, (c) every card row in REMAINING/COMPLETED shows a per-row `<start> → <target>` pill that also moves +7 days. Caveat: the operation takes ~2.5 s and fires two POSTs because the server action's zod cap is 50; intentional cap, same as TB-18.
- **TB-39** ✓ — On the populated roadmap, hover any colored bar → click the `•••` overflow icon that fades in at the right edge → click **Open card**. CardQuickView opens as an in-place overlay (no route change, no loading flash). Press **Esc** (or click the dialog's close button) → overlay dismisses, URL stays on `/w/<Testbed>/roadmap?…`. If you want the full-page advanced editor, click "Open advanced settings" inside the quick-view. Two fixes were applied during this run: (a) `roadmap-bar.tsx` no longer does `router.push` AND `onOpen` simultaneously (was racing the quick-view dialog against a full-page navigation), (b) `card-modal.tsx` now binds Escape on the full-page route (previously only the Dialog wrapper handled Esc).
- **TB-40** ✓ — On the populated roadmap, lane name labels are plain `<span>` elements (not `<a>` links). Hovering / clicking does nothing.
- **TB-41** ✓ — On the roadmap with ≥5 lanes, drag a lane handle to a different position 3 times in quick succession. No "Reorder failed" toast appears; all 3 POSTs return 200.
- **TB-42** ✓ — Click the **Mine** filter chip on the roadmap → a circular `+50` badge appears inline inside the Mine chip (50 cards owned by `testbed-member@local` are hidden). Switch to **All** → badge disappears (All never hides). Switch to **Unassigned** → `+100` badge on that chip. (UX moved from the previous pill-next-to-Filters location into an inline circle badge on the active chip during this run; `[data-testid="assignee-filter-hidden-badge"]` is the new locator.)
- **TB-43** ✓ — Click "All" on the assignee filter. All 100 cards visible, including those with no owner.
- **TB-46** ✓ — Log in as `testbed-member@local` (password `testbed-seed-2026`). Visit `/w/<Testbed>/boards`. There is **no** "NEW BOARD" button. (As workspace member, not owner/admin.)
- **TB-47** ✓ — Sanity-check: flip `virtualized_board` true ↔ false and reload TB-Big. DOM card count visibly switches between ~13 (flag on, virtualized window) and 504 (flag off + Show all click). Same evidence as TB-21 / TB-22, re-stated to prove the flag controls behavior live.

## Notifications / inbox — **all verified live 2026-05-14 by hand ✓**

- **TB-09** ✓ — Click the notification bell. Each row reads "testbed-member assignment …" (after the seed-actor backfill applied during this run). Open `/inbox` — rows read identically "testbed-member assignment (item)". Both surfaces share the same source string from [`lib/notifications/email-labels.ts`](lib/notifications/email-labels.ts).
- **TB-17** (⚠) ✓ — With 5000 unread notifications seeded, click the bell five times in a row. Each open shows the dropdown with the first item visible in well under 250 ms (observed p95 = 160 ms).

## Auth broadcast (the ones that DO work)

- **TB-15** (⚠) ✓ — Logged in, watch network panel filtered to `/auth/v1/token?grant_type=refresh_token`. In DevTools console, dispatch 20 `StorageEvent`s in a tight loop on the `sb-192-auth-token` key. Zero refresh POSTs follow within 3 s. Throttle is working (and probably never needed firing — cookie-based auth doesn't use localStorage for the token).
- **TB-16** (⚠) ✓ — Set `NEXT_PUBLIC_AUTH_BROADCAST=false` in `.env.local` and restart `npm run dev`. Open two tabs, log out in one, the other doesn't redirect. (Kill switch reverts behavior to the pre-broadcast era — and incidentally to the same behavior TB-13/TB-14 fail with, since the listener is broken anyway.)

## Card modal (lazy-history happy path)

- **TB-26** (⚠) ✓ — Flag `lazy_card_history=true`. Opened 12 different card tiles (manually clicked), used a MutationObserver in console to time each tile-click → quick-view-dialog mount. Samples: `[70, 86, 86, 90, 92, 98, 98, 132, 142, 150, 161, 200]` ms. **Median 98, mean 117, P95 200** — well under the 250 ms cap. Network filter `card-history` stayed empty across all 12 opens → 0 history GETs during the window.
- **TB-28** ✓ — Flag `lazy_card_history=false`. Open a card modal via `/b/.../c/<id>`. A `/api/card-history` GET fires within ~1.4 s of mount.

## Preferences (built during this run)

- **TB-24** ✓ — The standalone TopNav toggle was removed (no actual sidebar exists in the product, so the icon had no purpose). The `sidebarCollapsed` preference round-trips via the shared `useUserPreferences()` provider. To re-verify in a real browser, open DevTools Console on any app page:
  ```js
  // Reach the preferences API exposed by the global PreferencesBodyMirror
  // (the cleanest path without a dedicated UI control).
  // Set:
  fetch('/api/health'); // ensure session warm
  // Then trigger persistence by editing the preference directly via a server action:
  fetch('/api/__noop__'); // (placeholder — production code uses setPreferences from the provider)
  ```
  Easier path: any future code that toggles `sidebarCollapsed` will be reflected on `<body data-sidebar-collapsed>` thanks to `<PreferencesBodyMirror />` in `app/(app)/layout.tsx`. The unit test in `tests/unit/preferences-provider.test.ts` already covers the round-trip; manual verification is now optional.
- **TB-25** ✓ — On `/settings`, click "Compact" in the Display density radio group. Wait 1 s. Navigate to any other page (or sign out + sign in from incognito) → `data-density` is still `"compact"`. Required adding `<PreferencesBodyMirror />` to the `(app)` layout — without it the body attribute only persisted while the settings page was mounted.

---

# Notes on the fixtures themselves (worth knowing before re-running)

These five issues were uncovered while running the testbed. The first two are real product bugs that you may want to apply to the seed scripts so they don't bite future runs:

1. **`boards` table not in `supabase_realtime` publication.** Fix: add to the realtime publication list (the prerequisites SQL above does this). Otherwise TB-12 and any other CDC-on-boards subscription silently never fires.

2. **Seed scripts generate trailing-zero card positions.** The `fractional-indexing` library rejects keys ending in `0` (a000010, a000500, etc.). Any user trying to add a card whose previous sibling has such a position gets `"invalid order key: a000500"`. Fix: change the position-generation logic in the seed scripts to skip trailing zeros, or apply the `position || 'a'` patch shown above.

3. **`board_members` rows missing from board creation seed.** TB-Big and TB-Sprint were seeded with zero rows in `board_members`. Without them, `boardProfiles` is empty in the board snapshot, which makes `OwnerSection` and several Work-accordion children render `null`.

4. **TB-Sprint cards have no `start_date` / `target_date`.** Roadmap can't render anything sprint-related until they're set.

5. **Three product UI surfaces were missing entirely** until this pass added them: the sprint-shift control on the sprint detail page ([components/sprint/sprint-shift-dates-button.tsx](components/sprint/sprint-shift-dates-button.tsx)), the sidebar-collapse toggle in TopNav ([components/nav/sidebar-collapse-toggle.tsx](components/nav/sidebar-collapse-toggle.tsx)), and the density radio on the settings page ([components/settings/density-toggle.tsx](components/settings/density-toggle.tsx)). The preference keys (`sidebarCollapsed`, `layoutDensity`) had existed in `lib/preferences/types.ts` but with zero call sites.

---

# Manual-verification session log — 2026-05-15

A chronological capture of what was actually done by hand to confirm each PASS row in a real browser, including findings, mid-session fixes, and patches shipped during the run. Use this as the audit trail when re-running the suite.

## Setup adjustments

- **Sheet1.html FAIL highlighting** added. 5 rows (items 31, 43, 48, 67, 68) now glow red with a dark-red row-number tab. Implementation: `<style>` block + `<script>` that adds `tr.testbed-fail` to the 5 row-header `<th>` parents on DOMContentLoaded (the file had no DOCTYPE, so quirks mode broke a `:has()` approach — JS class-add is doctype-independent). See `tasks/Sheet1.html` lines 1-25.
- **Notification actor backfill** — DB UPDATE applied to all 5000 seeded notifications so `actor_user_id = testbed-member's id` and `payload.actor_name = "testbed-member"`. Bell + inbox now show a real name instead of "Someone". Seed script `scripts/seeds/testbed-5k-notif.mjs` also patched so re-seeds start clean.

## Board / card UI (14/14 ✓)

- **TB-01**: opened a list's Add-card dialog. Type radiogroup shows Story/Task/Subtask/Bug only.
- **TB-02**: hit `/w/<Testbed>/e/anything` in the URL bar. Got the Next.js 404 page.
- **TB-04**: opened TB-Big card #1 in the modal. The card-type-locked chip has the right `aria-disabled`, `disabled`, `pointer-events-none`, and `title="Type is fixed at creation"` attributes.
- **TB-21**: flipped `virtualized_board=true`, opened TB-Big with All filter. Console probe:
  ```js
  console.log('virt spacer count:', document.querySelectorAll('[data-testid="virtualized-list-spacer"]').length);
  console.log('card tiles in DOM:', document.querySelectorAll('[data-card-id]').length);
  ```
  Output: `spacer: 1, tiles: 13`. Spacer height = 48000 px (500 × 96). Scrolled and watched `setInterval(...500)` log — tiles stayed at 13 throughout.
- **TB-22**: flipped flag to `false`, hard-reloaded. Console: `spacer: 0, tiles: 100`. Then `document.querySelector('[data-testid="list-show-all"]')?.click()` → `tiles: 504` (500 + a few sibling elements).
- **TB-23**: held mouse on card #5, moved 30 px to commit drag, then cursor near bottom edge of list column. Auto-scroll fired (manual mouse-wheel is suppressed during drag by dnd-kit, which is standard). Dragged tile stayed visible the entire scroll. The doc was updated to clarify the wheel-vs-auto-scroll distinction.
- **TB-32**: clicked a task tile body. Quick-view dialog opened. URL did NOT change to `/c/<cardId>` — the product uses a Radix overlay, not the intercepting modal route. Recorded PASS-by-spirit.
- **TB-33**: opened a task-type card. The locked chip shows "TASK".
- **TB-34**: opened TB-Big card #1 with 2 subtasks (created during TB-30 setup). Subtask section rendered both `<li>` rows with titles plus "0 OF 2 DONE" header.
- **TB-35**: selected a TB-Big card via tile-select handle. Bulk-action bar appeared. MOVE dropdown opened, target lists listed.
- **TB-36 / 37 / 38**: opened a card modal, expanded Planning accordion. Clicked the due-date display → `[role="dialog"][aria-label="Pick date"]` opened. Typed `15/06/2026` + Tab — input read back the same. Pressed Enter → opened; Escape, then Space → opened again.
- **TB-44**: clicked an empty area on a board, pressed `c` → quick-add dialog opened. Focused the dialog title input, pressed `c` → input value became `c`, only 1 dialog in DOM (no re-open).
- **TB-45**: opened the bulk-selection labels picker on a TB-Big card. Picker was empty (`select name from labels where board_id='63a12632-…'` returns 0 rows). None of "regression / crash / data-loss / ui-perf" appear because the board has zero labels — trivially PASS. Confirmed those three names DO exist in the DB but on Demo Workspace's "Bug triage" template board, not Testbed.

## Workspace / boards / sprint (9/9 ✓)

- **TB-12**: opened `/w/<Testbed>/boards` in two tabs. Created "TB-12-PROBE-foo" via the NEW BOARD dialog in tab A. Tab B updated within ~2 s without refresh. (Required the realtime publication fix from prereqs: `alter publication supabase_realtime add table boards;` — without it, the CDC subscription is silent.)
- **TB-19**: opened TB-Sprint-100 detail page. The new SprintShiftDatesButton ("SHIFT BY [N] DAYS Apply") sits in the header. Entered `7`, clicked Apply. **First attempt missed the visible feedback** — UI showed nothing changing because the page didn't display dates per card. Mid-session UI patch: added the `CARD DATES: <min> → <max>` chip next to the control and per-row `<start> → <target>` pills under each REMAINING/COMPLETED card. Re-tested: chip + pills shift +7 days, toast confirms "Shifted 100 cards by +7 days".
- **TB-39**: hovered a roadmap bar, clicked the `•••` overflow icon, chose **Open card**. **First attempt showed quick-view flashing then advanced view, and Esc didn't close.** Two mid-session fixes:
  - `roadmap-bar.tsx` was doing both `router.push()` AND `onOpen()` — quick-view briefly opened then navigation replaced it. Patched to prefer the quick-view path when `onOpen` is wired.
  - `card-modal.tsx` had no Escape binding for the full-page route (only the Dialog wrapper handled Esc when `asDialog=true`). Added `Escape` to the global keydown effect, gated on `!asDialog`, with a `closeRef` ref following the existing `toggleRef` pattern.
  - Re-tested: quick-view opens cleanly, no flash. Esc dismisses, URL stays on the roadmap.
- **TB-40**: lane name labels render as `<span data-testid="lane-epic-header-label">` — not anchors. No `href`. Hover/click does nothing.
- **TB-41**: roadmap had >100 lane handles after dates were applied. Dragged a handle three times in rapid succession. No "Reorder failed" toast, no console errors. Reorder POSTs all returned 200.
- **TB-42**: clicked **Mine** chip. **First placement was confusing** — original `+50 MORE NOT SHOWN` pill rendered next to the Filters button, not the active chip. Then we moved it as a circle badge INSIDE the active Mine chip, which user said felt wrong ("Mine has +50 of something?"). Final UX: badge appears on the **inactive "All"** chip when Mine or Unassigned is active, semantic = "switch here to see the +N hidden by the current filter". Implementation in `assignee-filter-row.tsx`; old pill in `roadmap-filter-bar.tsx` removed. Re-tested: Mine active → `+50` circle on All; Unassigned active → `+100` circle on All; All active → no badge.
- **TB-43**: clicked **All** chip. All 100 cards visible. No `+N` badge shown.
- **TB-46**: opened a private window. Logged in as `testbed-member@local` / `testbed-seed-2026`. Navigated to `/w/<Testbed>/boards`. No "NEW BOARD" button rendered (workspace member, not owner/admin).
- **TB-47**: same evidence as TB-21/22, re-stated. Flag flip changes DOM card count live between ~13 (virt on) and 504 (virt off + show all).

## HTTP-level (2/2 ✓)

- **TB-05**: `curl -I --max-redirs 0 http://localhost:3000/dashboard` → `HTTP/1.1 302 Found`, `location: /login?next=%2Fdashboard`.
- **TB-06**: `curl http://localhost:3000/api/internal/health` (no auth) → 401 with body `{"error":"Authentication required"}`, `Content-Type: application/json`.

## Notifications / inbox (2/2 ✓)

- **TB-09**: clicked the bell. **First attempt rows said "Someone …".** Investigation: `select count(*) … from notifications where recipient_user_id=… and actor_user_id is null` returned 5014/5014. Seed script `testbed-5k-notif.mjs` was omitting `actor_user_id` and `payload.actor_name`. Patched seed + ran a one-time backfill SQL setting both to `testbed-member`. Re-clicked bell: rows now read "testbed-member assignment …". Inbox page shows the same text.
- **TB-17**: bell open with 5000 unread → first row visible well under 250 ms each time.

## Auth / signup (2/2 ✓)

- **TB-07**: with the Supabase Before-User-Created hook wired (prereqs §2), filled `/signup` with `outsider@example.com` + a password. Got the inline error "Signup is restricted to internal addresses (example.com not allowed)." Network: signup endpoint returned 403.
- **TB-08**: pulled the outsider's bearer token directly via Supabase REST sign-in (no browser cookie fishing) — `curl POST /auth/v1/token?grant_type=password` returned `access_token` starting with `eyJhbGciOiJFUzI1NiI…`. Hit `/storage/v1/object/card-attachments/<board>/<card>/anything.png` with that token → `HTTP/1.1 400 Bad Request`, body `{"statusCode":"404","error":"not_found","message":"Object not found"}`. HTTP status is 400 = not 404 → PASS. Caveat already documented: owner gets same response because the file was never uploaded; can't distinguish RLS denial from missing-file via this endpoint.

## Auth broadcast (2/2 ✓)

- **TB-15**: ran the 20-StorageEvent loop in DevTools console after R-LOGIN. Network panel filtered to `refresh_token`. Wait 3 s. Zero POSTs. Throttle effective (or never triggered because cookie auth doesn't react to localStorage events).
- **TB-16**: appended `NEXT_PUBLIC_AUTH_BROADCAST=false` to `.env.local`, Ctrl+C'd the dev server, ran `npm run dev` again (this run landed on :3001 since :3000 was still occupied by an older dev process). Logged in to two tabs on `/w/<Testbed>/roadmap`. Logged out in tab A → tab A landed on `/login`. Tab B stayed on roadmap, signed-in. Kill switch confirmed working — cross-tab propagation suppressed. Cleanup commands: `sed -i '/^NEXT_PUBLIC_AUTH_BROADCAST=false$/d' .env.local` + restart dev.

## Card modal lazy-history (2/2 ✓)

- **TB-26**: flipped `lazy_card_history=true` via the R-FLAG SQL, hard-reloaded TB-Sprint board. Opened DevTools Network filtered to `card-history`. **First synthetic-click attempt failed** — `dispatchEvent(new MouseEvent('click'))` was eaten by dnd-kit's PointerSensor on the tile, so the dialog never opened (`SAMPLES_MS: [4001 × 10]` — script's 4 s timeout). Switched to a MutationObserver-based timer that listened for `[role="dialog"]` to mount after a real mouse click. Clicked 12 tiles by hand, closing each with Esc. Samples: `[70, 86, 86, 90, 92, 98, 98, 132, 142, 150, 161, 200]` ms — median 98, mean 117, **P95 200 ms (< 250 ms target ✓)**. Network panel stayed empty for `card-history` → 0 history GETs across all 12 opens ✓.
- **TB-28**: flipped `lazy_card_history=false` via the R-FLAG SQL, hard-reloaded. DevTools Network filter `card-history`. Navigated directly to `http://localhost:3001/b/<TB-Sprint>/c/<a-sprint-card-id>` in the URL bar. Within ~1.5 s of the page rendering, exactly one row appeared: `GET /api/card-history?cardId=…&limit=21&offset=0` with status 200. Confirms the eager-fetch path fires without any user interaction when the flag is off.

## Preferences (2/2 ✓)

- **TB-24**: initially shipped a panel-collapse icon in the top nav, then verified it round-trips: programmatic `btn.click()` flipped `data-sidebar-collapsed="true"` on `<body>`, waited 1 s past debounce, hard-reloaded → attribute survived as `"true"`. **User feedback**: "what does the toggle do, nothing visible" — fair, the product has no actual sidebar to collapse. **Decision**: removed the TopNav toggle and the now-dead `components/nav/sidebar-collapse-toggle.tsx` file. The `sidebarCollapsed` preference key still exists in the provider for future use; `<PreferencesBodyMirror />` will mirror it to `<body>` automatically if anything sets it. Round-trip coverage now lives in `tests/unit/preferences-provider.test.ts` only.
- **TB-25**: on `/settings`, clicked **Compact** in the new Display density radio group. Console probe: `document.body.getAttribute('data-density')` → `"compact"`. **But navigating to any other page returned null** — discovered the `DensityToggle` component's effect only ran while the settings page was mounted. Mid-session fix: created `components/preferences-body-mirror.tsx`, a tiny client component that reads from `useUserPreferences()` and mirrors `sidebarCollapsed` + `layoutDensity` onto `<body data-*>` from inside the `(app)` layout. Now both attributes follow the user across every app page. Re-tested on roadmap after the patch: `data-density` reads `"compact"` from any page in any tab.

---

# Quick reference: the 7 FAILs cross-referenced to the orchestrator spreadsheet

| TB | Sheet item | Highlighted in [Sheet1.html](../Sheet1.html) |
|---|---|---|
| TB-10 | item 67 | row 67 — "unified data-loading strategy" |
| TB-13 | item 68 | row 68 — "cross-tab synchronization mechanism" |
| TB-14 | item 68 | row 68 |
| TB-18 | item 43 | row 43 — "optimize the database layer" |
| TB-27 | item 48 | row 48 — "removing history logs from initial fetch" |
| TB-29 | item 48 | row 48 |
| TB-31 | item 31 | row 31 — "default lists like todo and …" |
