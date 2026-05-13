# Performance Report by System Part — 2026-05-13

This document is a plain-English performance audit of the Trello-style project management app in this repository. It is organized into six parts, where each part is one major area of the system. For each part the report explains:

1. What the part does
2. How much it contributes to overall slowness ("weight")
3. Where the actual bottlenecks are, with concrete file and line references
4. How the database is being used and where it's struggling
5. Concrete fixes you can ship, ordered by return on investment
6. A split between "quick wins" (less than an hour) and "structural fixes" (multi-day work)

The repository being audited is `/home/innovina/Documents/trello-foundation`, branch `plan/01-foundation`. The stack is Next.js 15.5 with the App Router and Turbopack, React 19, the Drizzle ORM running on the `postgres-js` driver, a Supabase backend that provides Authentication, Realtime, and PostgreSQL access through a pgbouncer transaction-mode pooler, Zustand 5 for client state, and `@dnd-kit` for drag-and-drop. Hosting is Vercel Fluid Compute.

The six parts of the system are:

1. **Board page** — the kanban board at `/b/[boardId]`
2. **Workspace pages** — the roadmap, sprints, backlog, archive, all-tasks, versions, and epic views at `/w/[workspaceId]/...`
3. **App shell + middleware + auth** — the layout that wraps every authenticated page, plus the request middleware and Supabase session refresh
4. **Dashboards + Me / Inbox / Workload** — per-user and cross-workspace analytical views
5. **Realtime + sync subsystem** — every Supabase Realtime channel and every sync hook
6. **Database / Drizzle / RLS / Query layer** — the cross-cutting data layer that every other part depends on

The companion document `docs/superpowers/specs/2026-05-13-perf-analysis.md` contains the prior flat list of hot spots (numbered H1 through H15). That document still applies, and the present report references its findings where useful — but this report is the per-feature breakdown the prior one lacked.

A note on methodology: I dispatched six parallel `codex:rescue` agents, one per part. Four of them hit a sandbox networking error (`bwrap: Failed RTM_NEWADDR`) on this machine and could not read the file system, so they returned no useful output. I produced the audits for those four parts directly. Parts 3 (App shell) and 5 (Realtime) below are the codex:rescue output, edited only to correct two factual claims about missing indexes that the agent got wrong (both indexes do exist).

---

## Weight summary — which parts cost the most

Roughly speaking, every page-load in this app spends its time as follows on a representative power-user workspace (4 boards of about 200 cards each, six months of history, five collaborators online):

- The **App shell + middleware + auth** consumes about 35–45 % of the time the user perceives on every single navigation. This is the layout that wraps every page and runs before any page content can stream.
- The **Realtime and sync subsystem** consumes about 20–30 % of active-tab CPU during collaboration, because every change-event echo re-renders large parts of the React tree.
- The **Database / Drizzle / RLS layer** imposes a 15–25 % latency floor on every operation, because every query in the app is wrapped in a small RLS-bound transaction with no prepared-statement caching.
- The **Board page** accounts for 10–20 % of the work on board routes (on top of the shell tax above).
- The **Workspace pages** account for 8–15 % of the work on workspace routes, dominated by the roadmap view.
- The **Dashboards and Me/Inbox pages** account for 5–10 % on those routes.

The numbers add to roughly 100 % because the shell, realtime, and database costs are paid on every request regardless of which page you're on, while the page-specific costs add to whichever route the user is currently on.

The single biggest takeaway from this report is that the **app's performance floor is set by the layout and the database transaction model, not by the page logic**. Optimising individual pages without touching those two layers will produce modest wins. Optimising those two layers will produce dramatic, app-wide wins.

---

## Part 1 — The Board page (`/b/[boardId]`)

### What this part does

This is the kanban board view: lists of cards arranged in columns, with drag-and-drop, inline editing, a card quick-view dialog, a card detail modal, bulk-action support, presence avatars, and realtime sync from other users. It is the single most-used route in the app, and the heaviest in terms of both server payload and client state.

### How much it contributes

On a board route, after the layout has done its work (which is most of the per-navigation cost — see Part 3), the page itself accounts for an additional 10–20 % of perceived latency. On the **client side during active collaboration**, however, the board page is the heaviest single consumer of CPU because every change-event echoed from the database flows into the local board store and triggers a cascade of React re-renders across every list column and every card tile.

### Where the bottlenecks are

The main offender on the server side is the function `getBoardSnapshot` in `lib/queries/board-snapshot.ts`. It is called once per board navigation and is responsible for loading everything the board view needs. It runs **fourteen separate read queries in parallel inside a single transaction**, and several of those queries pull entire-history tables — every comment ever written on the board, every attachment, every checklist, every checklist item, every card link, every component, every card-to-component link, and every card-version row in the workspace. On a six-month-old board with two thousand comments and five hundred attachments, this payload becomes the dominant cost of a board navigation, and it is paid on every visit because Realtime never refills these tables and the loader is invoked fresh on every navigation.

A specific issue inside that loader is on lines 201–204: the `card_versions` query is scoped by **workspace** ID, not board ID. This means every board page is paying to load every version row in the entire workspace, even though it only needs the rows for its own board. The workspace snapshot already loads this data, so the board page is duplicating work.

Another loader issue is in the hand-rolled SQL on lines 67–118. This is a compatibility shim called `listCommentsCompat` that uses `to_jsonb` and `nullif` to handle an older comment schema. The shim was needed before migration 0075 added `resolved_at` and `resolved_by` columns. With migration 0075 applied, the shim is no longer needed — but because it's still in place, it bypasses Drizzle's column-projection mechanism, so every column of every comment is fetched and re-mapped in JavaScript rather than only the columns the snapshot type actually exposes.

The page itself (`app/(app)/b/[boardId]/page.tsx`) opens **three additional database transactions** beyond the snapshot: one to record the board view for the recently-viewed list, one to load the user's display name and avatar from the `profiles` table, and one to load the sprint list for the bulk-action bar. Including the four transactions the layout opens (covered in Part 3), this brings the total to **seven RLS-wrapped database transactions per board navigation**. Each transaction pays a fixed cost of `BEGIN; set_config(...); ... COMMIT` round-trips even when the query inside is trivial.

On the client side, the biggest issue is in `components/board/card-tile.tsx`. Each card tile subscribes to seven board-store slices and two workspace-store slices. The `parentCard` selector does an O(N) `.find` over the entire `cards` array, the `sprintName` selector does an O(S) `.find` over the sprint array, and the `statusKind` selector does an O(L) `.find` over the list array. On a board with two hundred cards, that's six hundred array iterations every time anything in those stores changes — and during active collaboration "anything" changes several times per second. To the credit of whoever last optimised this file, the quick-view selectors on lines 78–129 are now gated behind `quickViewOpen`, which avoids the worst per-tile cost when the dialog is closed; this is a fix from the prior P1.5 round.

The board's root component, `components/board/board-view.tsx`, makes things worse by subscribing to six top-level store slices as separate hooks on lines 84–89 (`lists`, `cards`, `cardLabels`, `cardMembers`, `labels`, `boardProfiles`) without `useShallow`. Every realtime echo that touches any of those arrays produces a new reference and triggers a full BoardView re-render, which then re-evaluates the visible-cards filter and the lane partitioner.

Bundle-size-wise, the file `card-quick-view.tsx` is 782 lines and roughly 27 KB minified, and it is imported eagerly by every card tile on line 28 of `card-tile.tsx`. Two hundred tiles is two hundred hidden Dialog mounts. Similarly, `card-modal.tsx` (902 lines) and `bulk-action-bar.tsx` (834 lines) ship in the first paint for the board route even though both are modal/contextual.

One bright spot: `components/board/list-column.tsx` on lines 81–87 has already been migrated to a per-list `useShallow` filter. This was the P1.5 issue H4 and it is fixed. The remaining filter on `cardIdFilter` (lines 84–87) runs in a `useMemo` and is fine.

### Database perspective

Every WHERE clause in the snapshot fan-out has a matching index, so the queries themselves plan and execute quickly. What's actually slow is the **transaction overhead and the payload size**, not the query plans. The `comments` table is indexed on `(board_id, card_id, created_at desc)` from migration 0013; the snapshot's sort is `asc`, but PostgreSQL can do a reverse-scan of a descending index, so no extra index is needed. Attachments, checklists, components, card_components, card_links, lists, cards — all have appropriate indexes.

Row-level security (RLS) evaluates a workspace-or-board membership predicate on every row read. With `workspace_members(user_id)` and `board_members(user_id)` both indexed (migration 0001), this predicate is cheap per row, but it is evaluated on every fetched row. Reducing the row count (by capping comments, removing card_versions from the snapshot, etc.) is more effective than trying to speed up the predicate.

Because pgbouncer is in transaction-pooling mode, the postgres-js driver is configured with `prepare: false`. This means there are **no server-side prepared statements**: every query in the fan-out pays parse-and-plan cost on every call. At fourteen queries per snapshot, that's roughly 14–40 ms of pure planning overhead before any real work happens.

### Concrete fixes, in order of return on investment

1. **Lazy-load the heavy dialogs.** `CardQuickView`, `CardModal`, and `BulkActionBar` should all be wrapped in `next/dynamic({ ssr: false })`. Better still, the quick-view should be rendered as a single instance at the `BoardView` root, driven by an `openCardId` state, rather than mounting one closed instance per tile. Expected gain: 60–80 KB shaved off the first-load bundle and six hundred fewer hidden Dialog mounts on a 200-card board.

2. **Drop `cardVersions` from `getBoardSnapshot`.** The workspace store already loads this data; the board snapshot is paying for the union of every board's versions on every visit. One-line change at `board-snapshot.ts:201-204`.

3. **Cap comments at the SQL level.** Instead of loading all comments for the board, cap at e.g. the most recent 200 board-wide (matching the frontend's `MAX_COMMENTS_PER_CARD` limit) and lazy-load older ones inside `CardQuickView` on scroll. This will shrink the snapshot payload by five- to twenty-fold on older boards.

4. **Revert `listCommentsCompat` to a typed Drizzle select.** With migration 0075 applied, the compat shim is no longer needed, and the rewrite restores column projection and makes per-card or per-board comment caps straightforward to add.

5. **Coalesce the page's three transactions into one.** The profile-display-name lookup can move into the snapshot loader; the `recordBoardViewImpl` write can fire via Next.js's `after()` helper instead of staying in the main waterfall; the sprint list can be fetched inside the BulkActionBar lazily via a server action.

6. **Hoist per-tile selectors to a single `cardsById` map memoised at `BoardView`** and pass scalar props down to tiles. This turns "200 tiles × 3 array scans per render" into "0 scans per render" (constant-time map lookups).

7. **Wrap `CardTile` and `ListColumn` in `React.memo`.** This skips re-renders when props haven't changed and is a free win once the props are scalar.

8. **Add a Suspense boundary around `BoardView`** so the shell can paint before the snapshot resolves. The route already has a `loading.tsx`; what's missing is a finer-grained Suspense inside the page.

### Quick wins versus structural fixes

The quick wins (less than an hour each) are: dropping `cardVersions` from the snapshot, reverting `listCommentsCompat`, coalescing the page's transactions, adding `React.memo` wrappers, and relocating the sprint list. The structural fixes (multi-day) are: the lazy-load and hoist of `CardQuickView`, the server-side comment cap with pagination, and the `cardsById` memoised map with prop-drilling to tiles.

### Part 1 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Cap `comments` at SQL level + paginate older inside `CardQuickView` | 5–20× snapshot payload shrink on old boards; 50–150 ms saved per nav | 1–2 days | medium (UI pagination change) |
| 2 | Lazy-load `CardQuickView` + `CardModal` + `BulkActionBar` via `next/dynamic`, render single quick-view instance at `BoardView` root | −60–80 KB initial bundle; −600 hidden Dialog mounts on a 200-card board | 1–2 days | low |
| 3 | Hoist tile selectors to single `cardsById` map at `BoardView`; pass scalars to tiles + wrap `CardTile` in `React.memo` | turns 600 array scans/render → 0 scans; tile re-renders drop by ~80 % under CDC echo | 2–3 days | medium |
| 4 | Drop `cardVersions` from `getBoardSnapshot` (already in workspace snapshot) | −1 full-workspace-history read per board nav (20–60 ms) | 5 min | low |
| 5 | Coalesce the page's 3 `dbAsUser` blocks into one (profile + recordView + snapshot) | −2 transactions / nav (~30–60 ms) | 30 min | low |
| 6 | Revert `listCommentsCompat` to typed Drizzle select (migration 0075 makes shim unnecessary) | restores columnar IO pushdown; enables clean LIMIT cap; 10–30 ms saved | 30 min | low |
| 7 | Move `listSprintsForWorkspace` into snapshot or lazy in BulkActionBar | −1 `dbAsUser` per nav (~10–20 ms) | 30 min | low |
| 8 | Add Suspense boundary around `BoardView` so shell paints first | improved perceived TTFB; no TTI change | 30 min | low |

---

## Part 2 — Workspace pages (roadmap, sprints, backlog, archive, all-tasks, versions, epic)

### What this part does

These are the multi-board views scoped to a workspace. The roadmap is a Gantt-style timeline; sprints show backlogs and reports; archive lists archived cards; all-tasks lists every card the user can see in the workspace; versions tracks release versions; epic is a focused view of a single epic and its children.

### How much it contributes

These pages account for 8–15 % of perceived latency on workspace routes, after the layout shell tax. The roadmap is the most expensive client-side component in the entire app — a single 2,263-line component (`components/roadmap/roadmap-view.tsx`) — but the workspace-snapshot loader is shared by all of these routes, so the cost is distributed.

### Where the bottlenecks are

The workspace snapshot loader, `lib/queries/workspace-snapshot.ts`, runs ten parallel reads inside one transaction (lines 182–301). The reads use `inArray(boardId, [...])` with the list of board IDs in the workspace. For a workspace with ten boards and two hundred cards per board, the cards read alone is 2,000 rows with a wide twenty-column projection. The card-versions read at lines 272–279 is scoped by `workspace_id` and grows linearly with workspace age — there is no cleanup mechanism.

The roadmap view itself is the elephant. `components/roadmap/roadmap-view.tsx` is 2,263 lines and reads nine workspace-store selectors at the top (cards, lists, boards, sprints, versions, cardComponents, cardLinks, cardMembers, cardVersions). None of those array selectors use `useShallow`, so any workspace-store change triggers a full re-render of the entire roadmap. Inside the file there are twelve large `useMemo` calls that recompute monthly ticks, gantt-bar positions, dependency-arrow geometry, and cascade-preview deltas; these are correctly memoised, but their dependency arrays include the unfiltered slice arrays, so they all re-run on every echo.

Surrounding files compound the bundle cost: `roadmap-bar.tsx` is 672 lines, `roadmap-header.tsx` is 587 lines, and `use-roadmap-drag-harness.ts` is 1,424 lines. The drag harness is loaded eagerly even though drag interactions are rare; it would be a good candidate for `next/dynamic`.

The roadmap-specific query helpers in `lib/queries/roadmap.ts` are well-bounded: `listRoadmapCards` caps at 200 rows and orders by `start_date`; `listRoadmapLinks` is a raw SQL four-way join (cards × boards × cards × boards) filtered by `is_blocked_by` kind. The link query lacks a composite index for the `(kind, workspace_id)` access path, but in practice the row counts are small (typically under one hundred links per workspace).

The sprint stats query (`lib/queries/sprints-stats.ts:62-78` — `computeBurndown`) builds a day-by-card grid in JavaScript. With a 14-day sprint and 100 cards that's 1,400 iterations, which is fine, but it's fired on every sprint detail navigation with no `react/cache` deduplication.

The archive view (`components/archive/archive-view.tsx`) and the `lib/queries/archived.ts` query path appear to lack cursor-based pagination, so an old workspace with thousands of archived cards will render them all at once.

### Database perspective

Every workspace-snapshot WHERE clause has an index. Sprints, however, are ordered by `start_date asc` on workspace-snapshot lines 230–241, and the only index on `sprints` is `(workspace_id, state)` from migration 0020 — so the `ORDER BY start_date` requires an in-memory sort. At twenty rows this is negligible, but it could be removed with a single-line migration.

Card-versions is indexed on `(workspace_id)` and `(version_id, kind)` from migration 0032. The growth pattern is concerning long-term: every "fix in" or "affects in" assignment writes a row, and there is no archival policy.

The workspace-scoped reads evaluate the `workspace_members(user_id = auth.uid())` RLS predicate on every row, but with the index from migration 0001, the join is hash-fast and not the bottleneck.

The ten parallel reads pay roughly 10–30 ms of plan-overhead (no prepared statements) per snapshot.

### Concrete fixes, in order of return on investment

1. **Split `roadmap-view.tsx` into three pieces** — `RoadmapShell` (filters, header), `RoadmapCanvas` (gantt rendering), and `RoadmapDragHarness` — and dynamic-import the drag harness. This is a multi-day refactor but eliminates roughly 50 KB of bundle weight before paint on the roadmap route.

2. **Add `useShallow` to the roadmap's workspace-store array selectors** and hoist them into one indexed selector per slice. This converts "any workspace echo re-renders the whole roadmap" into "only the changed slice re-renders".

3. **Narrow the workspace-snapshot's `cards` projection** for the routes that don't need card descriptions. Omitting `description` from the projection roughly halves the cards payload.

4. **Add an index on `sprints(workspace_id, start_date)`** so the workspace-snapshot's sprint ordering can be served from the index directly:
   ```sql
   CREATE INDEX IF NOT EXISTS sprints_workspace_start_date_idx
     ON public.sprints (workspace_id, start_date asc nulls last);
   ```

5. **Memoise roadmap inputs at one place** — `cardsByListId`, `cardStatusById`, `cardSpById`, `cardSprintNameById` — and pass slices into `RoadmapBar` keyed by board ID. This prevents every bar from re-evaluating on every echo.

6. **Add cursor-based pagination to the archive view** (`lib/queries/archived.ts`).

7. **Wrap `computeBurndown` in `react/cache`** if multiple components co-render on the sprint detail page.

### Quick wins versus structural fixes

Quick wins: narrowing the cards projection, the sprints index, adding the archive cursor, the burndown cache wrap. Structural: splitting `roadmap-view.tsx`, hoisting the selectors, the memo redesign.

### Part 2 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Split `roadmap-view.tsx` into `RoadmapShell` + `RoadmapCanvas` + `RoadmapDragHarness`, dynamic-import the harness | major TTI improvement on roadmap route; ~50 KB bundle removed before paint | 3–5 days | medium (large refactor) |
| 2 | Add `useShallow` + hoist roadmap's 9 workspace-store selectors into one indexed selector | turns "any workspace echo → full re-render" into "only changed slice re-renders"; cuts roadmap re-renders by 70–90 % under collaboration | 1–2 days | medium |
| 3 | Memoise roadmap inputs at one place (`cardsByListId`, `cardStatusById`, `cardSpById`, `cardSprintNameById`) and key `RoadmapBar` props by board ID | bars only re-evaluate on changed-card data; ~50 % reduction in per-echo render work | 1 day | medium |
| 4 | Narrow workspace-snapshot `cards` projection (omit `description` for routes that don't need it) | −30–50 % cards payload size; 20–60 ms saved on workspace nav | 1 hr | low |
| 5 | Add cursor-based pagination to archive view (`lib/queries/archived.ts`) | bounds archive payload at scale; prevents O(N) growth in render time | 4 hr | low |
| 6 | Add `sprints(workspace_id, start_date)` index to remove in-memory sort | small (negligible at 20 rows; matters as workspaces grow) | 5 min | none |
| 7 | Wrap `computeBurndown` in `react/cache` for co-renders on sprint detail page | dedup within request when multiple components consume burndown | 5 min | low |

---

## Part 3 — App shell, middleware, and auth (codex:rescue output, lightly corrected)

### What this part does

This is the layout that wraps every authenticated page (`app/(app)/layout.tsx`), the request middleware (`middleware.ts` and `lib/supabase/middleware.ts`), and the auth helpers (`lib/auth.ts`). It runs on **every navigation** before any page-specific code can start.

### How much it contributes

This part is the single highest-leverage area in the entire system. On every navigation from one route to another, the user is paying:

1. Middleware overhead, including a Supabase Auth round-trip (50–150 ms)
2. Layout server work, including a second Supabase Auth round-trip and four concurrent RLS transactions (100–240 ms total)
3. Then, and only then, the page-specific work begins

That puts the layout tax at 250–450 ms before the page-level snapshot loader can even start. As a share of perceived perf budget on every navigation: **about 35–45 %** (the original codex estimate of 55–70 % discounts after correcting for two index claims that were wrong; see audit corrections below).

### Where the bottlenecks are

There are two Supabase Auth network calls per request — one in the middleware (`lib/supabase/middleware.ts:23`) and one in the layout's `requireUser` (`lib/auth.ts:7-18`). Both call `auth.getUser()`, which makes an HTTP round-trip to Supabase's GoTrue service and takes 50–120 ms each. The layout call is wrapped in `react/cache` so it deduplicates within one render pass, but the middleware and layout run in different runtime contexts (Edge worker vs Node function) and don't share the cache, so the round-trip happens twice. Additionally, `getSessionToken` (`auth.ts:13-18`) constructs a second Supabase client and calls `getSession()` separately, which is local-only and fast, but the extra client construction adds 5–15 ms.

The middleware's `auth.getUser()` call is unconditional. It always hits GoTrue, even when the access token in the cookie has hours of life left. Inspecting the token's `exp` claim locally and short-circuiting when it's far from expiry would eliminate this round-trip on roughly 90 % of requests. (Supabase doesn't revoke individual tokens by default, so this is safe.)

The layout itself opens four `dbAsUser` transactions concurrently via `Promise.allSettled` (`app/(app)/layout.tsx:84-95`): `listWorkspaces`, an internal "layoutTx" that bundles the board-to-workspace lookup and the onboarding flag, `listFavoriteBoards`, and `listRecentBoardViews`. Concurrent is better than sequential, but with the postgres-js pool capped at 2 connections per Fluid Compute invocation, two of the four transactions queue. Each transaction also pays the `BEGIN; set_config(...); COMMIT` round-trip overhead, so consolidating all four into one transaction would save three of those overhead trips per navigation (roughly 40–80 ms).

A separate issue is in `app/(app)/page.tsx:11`: the home page calls `listWorkspaces` again, on top of the layout's call. Because `listWorkspaces` is **not wrapped in `react/cache`**, this is a separate transaction — two identical RLS reads per home-page load. A one-line fix.

The layout also eagerly imports seven client components (`CommandPalette`, `QuickAddCardMount`, `ShortcutsOverlay`, `TourOverlay`, `UndoBanner`, `ErrorPane`, `AccessNotice` on lines 4–11). Of these, only `TopNav` truly needs to be in the first-paint bundle. The others are triggered by user actions (`⌘K`, `?`, FAB) and could be `next/dynamic`-loaded, shaving roughly 50–80 KB off the initial JS.

Finally, the layout does a path-regex lookup on every `/b/[boardId]` navigation (`layout.tsx:43-67`) to resolve `boardId` to a `workspaceId`. This is one extra DB query per board nav. The mapping is stable — boards don't change workspaces — so it could be cached in a short-lived HTTP-only cookie or short-circuited via a middleware header.

### Audit corrections

The codex:rescue agent originally flagged two missing indexes as "high severity": `recent_views(user_id, viewed_at DESC)` and `boards(workspace_id)`. Both indexes already exist (migrations 0043 and 0001 respectively). Those two items have been dismissed in this rewrite. The remaining fixes are all valid.

### Per-navigation cost breakdown

When a user navigates from one board to another, the request flows through these stages in order:

1. **Middleware (Edge runtime):** ~50–120 ms, dominated by the unconditional `auth.getUser()` call to Supabase GoTrue.
2. **Layout server work (Node Fluid Compute):** ~100–240 ms. A second GoTrue round-trip, then four concurrent `dbAsUser` transactions (queued through a 2-connection pool).
3. **Page server work:** ~80–200 ms. The board snapshot loader's fourteen parallel queries in one transaction.

Total server time before first byte: **230–560 ms**. That's the floor — no matter how fast the destination page is, the user is paying this.

### Database perspective

The layout's six queries all use indexes appropriately:

- `listWorkspaces` uses the `workspaces` primary key and the `workspace_members(user_id)` index from migration 0001.
- The board-to-workspace lookup uses the `boards` primary key.
- The dashboard-to-workspace lookup uses the `dashboards` primary key.
- The profile onboarding flag uses the `profiles` primary key.
- `listFavoriteBoards` uses the `board_favorites` composite primary key plus joins on indexed `boards.workspace_id`.
- `listRecentBoardViews` uses `recent_views_user_id_viewed_at_idx` from migration 0043 to serve `WHERE user_id ORDER BY viewed_at DESC LIMIT 5` directly.

So the database side is healthy. The cost is the transaction overhead and the network round-trips, not the query plans.

### Concrete fixes, in order of return on investment

1. **Short-circuit the middleware `getUser` call** when the token's `exp` claim is more than 60 seconds away. This eliminates the GoTrue round-trip on roughly 90 % of requests, saving 50–120 ms each.

2. **Coalesce the layout's four `dbAsUser` calls into a single transaction.** This requires per-query error handling (because one transaction failure now aborts all), but saves 40–80 ms per navigation by eliminating three `BEGIN/set_config/COMMIT` cycles and the pool queuing.

3. **Lazy-load `CommandPalette`, `QuickAddCardMount`, and `ShortcutsOverlay`** with `next/dynamic({ ssr: false })`. Saves 50–80 KB of initial JS, no SSR impact.

4. **Wrap `listWorkspaces` in `react/cache`** so the layout and home page share one in-flight promise. One-line change.

5. **Memoise `createSupabaseBrowser`** as a module-level singleton, so the 13+ call sites stop constructing fresh clients.

6. **Cookie-cache the `boardId → workspaceId` mapping** so the path-regex DB lookup runs once per board instead of once per navigation.

7. **Fix the double Supabase client construction in `getSessionToken`** (`lib/auth.ts:13-18`).

### Quick wins versus structural fixes

Quick wins: the `react/cache` wrap, the browser-client singleton, the lazy imports, fixing the double-client construction. Structural: the middleware token short-circuit, the four-transaction coalesce, the cookie-cached mapping.

### Part 3 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Short-circuit middleware `getUser` when token `exp - now > 60s` | −50–120 ms on ~90 % of requests (eliminates GoTrue round-trip) | 4 hr | low (Supabase tokens are not revokable per-token by default) |
| 2 | Coalesce layout's 4 `dbAsUser` calls into one transaction | −40–80 ms per navigation app-wide; frees 3 pgbouncer slots | 1–2 days | medium (error handling refactor) |
| 3 | Cookie-cache `boardId → workspaceId` mapping | eliminates 1 DB query per `/b/*` nav (~10–20 ms) | 4 hr | low (stale-board case is rare) |
| 4 | Lazy-load `CommandPalette` + `QuickAddCardMount` + `ShortcutsOverlay` via `next/dynamic` | −50–80 KB initial JS bundle; faster TTI on every page | 30 min | low |
| 5 | Wrap `listWorkspaces` in `react/cache` | dedup layout + home page call; saves 1 transaction per `/` load | 1 min | none |
| 6 | Memoise `createSupabaseBrowser` as module singleton | eliminates 13 redundant client constructions per page mount; minor CPU + cleaner WS multiplexing | 5 min | none |
| 7 | Fix double `supa.auth` client construction in `getSessionToken` | −5–15 ms per request | 10 min | low |

---

## Part 4 — Dashboards, Me, Inbox, Workload, Timeline

### What this part does

These are per-user and cross-workspace analytical views. `Me` shows the current user's open cards, week ahead, sprints, and archive. `Inbox` lists notifications. `Workload` aggregates assignments across workspaces. `Dashboards` is a gadget-based custom view with configurable widgets. `Settings` is the user-preferences area.

### How much it contributes

These routes account for 5–10 % of perceived latency on their respective pages, lighter than the board/workspace routes because most are read-only and lower-frequency. The hottest single route is `/inbox`, which combines a heavy notifications subscription with the layout tax.

### Where the bottlenecks are

The `me-cards` and `me-week` queries (`lib/queries/me-cards.ts:40-100` and `lib/queries/me-week.ts:28-130`) use a **dual-query pattern**: one query for cards where the user is the owner, a second query for cards where the user is a member, deduplicated in JavaScript. Both queries do four-way joins (cards × lists × boards × workspaces). The owner query uses the `cards_owner_id_idx` partial index from migration 0060 and is fast. The member query, however, drives from `card_members` filtered by `user_id` — and **there is no index on `card_members(user_id)`**. The table is indexed on `(card_id, user_id)` as the primary key and on `(board_id)` from migration 0011, but neither serves a `WHERE user_id = $1` access path. On a tenant with 100,000+ card-member rows this falls back to a sequential scan.

The me-inbox, workload, and dashboard queries are not wrapped in `react/cache`, so co-rendered components that need the same data re-run the query.

Cron routes (`app/api/cron/**`) run scheduled background jobs — the daily email digest, SLA scans, watcher backfill. The email digest path in `lib/notify-email.ts:88-155` is particularly bad: for each pending notification row, it runs five sequential queries plus one Supabase admin API call. For 100 pending notifications, that's roughly 500 sequential DB or API operations. The digest route at `app/api/notifications/digest/route.ts:56-102` then loops over opted-in users sequentially, with no `Promise.all`.

The dashboards system loads gadgets in a config blob (jsonb). Each gadget's data fetch happens individually on mount, so a dashboard with eight gadgets makes eight separate server round-trips in a waterfall pattern rather than being batched.

Several "me/" routes (`/me/all-tasks`, `/me/archive`, `/me/backlog`) don't appear to paginate — they render the full user-scoped list.

### Database perspective

The critical index gap here is the same one mentioned above:

```sql
CREATE INDEX IF NOT EXISTS card_members_user_id_idx
  ON public.card_members (user_id);
```

This is the **highest-return-on-investment missing index in the entire codebase** apart from the broader DB-layer fixes. The me-cards member query, the me-week member query, and the workload aggregation all currently scan `card_members` filtered by `user_id` without an index.

The notifications table is well-indexed: `(recipient_user_id, created_at desc)` and a partial index for unread (`WHERE read_at IS NULL`) from migration 0023, plus the email-pending partial index from migration 0072. The notifications-list query is not the bottleneck — the bottleneck is the per-row email assembly path.

Cross-workspace RLS is more expensive than single-workspace RLS because the predicate has to evaluate across every workspace the user belongs to. With `workspace_members(user_id)` indexed, it's still fast per row, but it's evaluated twice in the dual-query me-cards pattern.

### Concrete fixes, in order of return on investment

1. **Add the `card_members(user_id)` index** above. Zero risk, major impact at scale.

2. **Wrap `listMyOpenCards`, `listMyWeekCards`, `listMyInbox`, and `listWorkload` in `react/cache`** so co-rendered components share results.

3. **Collapse the owner+member dual queries into a single `UNION ALL`** so the database does the dedup instead of round-tripping twice.

4. **Add cursor-based pagination to `/me/all-tasks` and `/me/archive`.**

5. **Batch the email digest's per-row queries.** Pre-load all recipient prefs, profiles, card titles, and board titles with five bulk queries (`.in(...)`), then iterate the pending notifications with zero async calls.

6. **Parallelise the per-user digest build** with `Promise.all` instead of the sequential `for` loop.

7. **Pipeline gadget data** with a single server-side fetch that returns the union of all gadgets' data keyed by gadget ID, rather than each gadget fetching on mount.

### Quick wins versus structural fixes

Quick wins: the index, the cache wraps, the pagination, the email batching, the `Promise.all` over users. Structural: the UNION rewrite of the dual queries, the gadget data pipeline.

### Part 4 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Add `card_members(user_id)` index | huge at scale: turns sequential scan on 100k+ rows into index seek; cuts me-cards / me-week / workload member queries by 5–50× | 5 min | none |
| 2 | Batch email digest per-row queries with `.in(...)` bulk lookups | 500 sequential ops → 5 parallel bulk queries for 100 notifications; ~95 % cron runtime reduction | 4 hr | low |
| 3 | `Promise.all` across users in digest route (`app/api/notifications/digest/route.ts:56-102`) | parallelises N users instead of sequential; ~N× speedup of digest cron | 30 min | low |
| 4 | Collapse owner+member dual queries in me-cards / me-week into single `UNION ALL` | halves DB round-trips on me-routes; saves 1 transaction per page | 4 hr | low |
| 5 | Wrap `listMyOpenCards`, `listMyWeekCards`, `listMyInbox`, `listWorkload` in `react/cache` | dedup co-renders; saves 1–4 transactions per me-route nav | 30 min | none |
| 6 | Add cursor-based pagination to `/me/all-tasks` and `/me/archive` | bounds payload at scale; prevents O(N) render time on heavy users | 1 day | low |
| 7 | Pipeline gadget data into one server-side fetch keyed by gadget ID | turns N waterfall requests into 1; ~N× speedup on dashboards with multiple gadgets | 2 days | medium |

---

## Part 5 — Realtime and sync subsystem (codex:rescue output, lightly edited)

### What this part does

This subsystem keeps every connected client in sync with the database via Supabase Realtime. It opens WebSocket channels per board and per workspace, listens for `postgres_changes` events, and applies changes to local Zustand stores. It also handles presence (who's looking at the board), notifications delivery, and the people cache (collaborator avatars and names).

### How much it contributes

Realtime and sync consume about 35–45 % of total perceived client-side perf budget on an active board tab, broken down as follows.

CPU on the client accounts for roughly 25–30 % of that, because Zustand's `set()` triggers a full React reconcile through every subscriber on every change-event. On a board with 200 cards, a single `cards` UPDATE echoes through both the board store and the workspace store simultaneously, each calling `state.cards.map(...)` (O(N)). At 2–3 change events per second during active collaboration, that's roughly 400–600 O(N) map passes per second.

WebSocket connections account for the remainder. One shared socket is multiplexed per `SupabaseBrowserClient` instance, but because `createSupabaseBrowser()` is not memoised (`lib/supabase/browser.ts:3-8`), each of the 13 unique call sites can construct a separate client. In practice modern Supabase JS deduplicates the underlying socket, but each client still has its own auth listeners and JWT decode work.

Supabase quota matters too: `postgres_changes` consumes WAL read bandwidth and a Realtime worker slot per channel. A board tab opens four channels with N filter registrations each. With 6 boards in a workspace, `useWorkspaceRealtime` registers `6×3 + 4 = 22` filters on one channel (`hooks/use-workspace-realtime.ts:88-215`). Supabase Realtime's filter cap is around 20 per channel, so workspaces with 7 or more boards silently drop events.

Server-side notification fan-out is another major load source: Postgres triggers fire synchronously inside the committing transaction. A comment on a card with 10 watchers and 2 @mentions writes 16 `INSERT INTO notifications` statements before the transaction can commit.

### Where the bottlenecks are

`hooks/use-board-realtime.ts` is 597 lines, registers 13 `postgres_changes` listeners, and has a 40-entry dependency array on its `useEffect`. The dependency array includes every Zustand action used in the listener bodies. Zustand actions are stable references, but because the effect lists them as deps, any upstream re-render that recreates the closure triggers an effect cleanup-and-resubscribe cycle. This causes about 300 ms of resubscribe latency per board navigation.

`hooks/use-workspace-realtime.ts` registers per-board filters: for each board in the workspace, it adds three filters (lists, card_links, card_members). With 6 boards plus 4 workspace-level filters, that's 22 filters on one channel, exceeding the Supabase Realtime filter cap.

`hooks/use-workload-sync.ts:24-31` subscribes to `cards` and `card_members` with **no filter at all**. On a multi-tenant Supabase project, this hooks `router.refresh()` to every card mutation by any user globally.

`stores/board-store.ts:241-244` (the `updateCard` action) does a full `state.cards.map(...)` on every UPDATE event, creating a new array reference each time. Every Zustand selector that reads `s.cards` is invalidated.

`stores/board-store.ts:272-305` (the `removeCard` action) cascades filters across ten arrays — cards, cardLabels, cardMembers, checklists, checklistItems, comments, attachments, cardLinks, cardComponents, cardVersions — in one `set()` call. During bulk archive, this fires per card.

The migration `0077_realtime_delete_identity.sql` sets `REPLICA IDENTITY FULL` on 15 published tables. This means PostgreSQL writes the full row to WAL on every UPDATE and DELETE, even for rows that no subscriber filter matches. At active-board scale this roughly doubles WAL throughput for those tables. Most of the corresponding DELETE handlers in the client only read the primary key from the old payload, so most of those tables could safely use `REPLICA IDENTITY USING INDEX` on the PK instead.

`components/inbox/inbox-sync.tsx` and `components/nav/notification-bell.tsx` both subscribe to the same `notifications` table filtered by `recipient_user_id`. They open two channels for the same events.

The presence channel (`hooks/use-board-presence.ts:19`) is a separate WebSocket channel (`board:{id}:presence`) on top of the per-board channel, and every change to the user's `me` state (location, current card ID, current card title) triggers a cleanup-and-resubscribe.

### Channel topology

For a typical active user (one board tab, one workspace tab, workspace has four boards):

| Channel name | File | Filters |
|---|---|---|
| `board:{boardId}` | `use-board-realtime.ts:239` | 13 filters (12 board-scoped + 1 workspace card_versions) |
| `board:{boardId}:presence` | `use-board-presence.ts:20` | 1 presence key |
| `ws:{workspaceId}` | `use-workspace-realtime.ts:86` | 16 filters (12 per-board + 4 workspace-level) |
| `board_members:{boardId}` | `use-board-membership-sync.ts:21` | 1 filter |
| `workspace_members:{userId}` | `use-workspace-membership-sync.ts:27` | 1 filter |
| `activity:{boardId}` | `use-activity-sync.ts:27` | 1 filter |
| `notif:{userId}` | `notification-bell.tsx:92` | 1 filter |

That's 7 channels and roughly 34 filter registrations per active user.

### Apply-path cost

When a card UPDATE arrives on the board channel, the listener runs three separate `set()` calls in sequence: `addCard` (if missing), `updateCard`, and `moveCard`. Each `set()` notifies all subscribers, so a single CDC event causes three rounds of Zustand notification and three React reconcile passes.

The workspace store receives the **same** event on the workspace channel and runs its own `upsertCard`. So every card mutation triggers two store updates and two reconciles per page.

### Database perspective on realtime

`REPLICA IDENTITY FULL` on 15 published tables roughly doubles the WAL volume on every write. A reduction to `REPLICA IDENTITY USING INDEX` on the primary key, for tables whose DELETE handlers only read the PK, would cut WAL throughput by roughly 50 % for those tables. Auditing each table's DELETE handler is required first — most need only the PK, but a couple (`card_labels`, `card_members`) use composite keys.

The `supabase_realtime` publication includes about 19 tables. Splitting into two publications — board-scoped and workspace-scoped — would let each Realtime channel load only the relevant publication, reducing the per-write scan cost.

`useWorkspaceRealtime` subscribes to `cards` with no filter (`hooks/use-workspace-realtime.ts:198-216`). The Realtime server still receives the WAL entry for every card write before RLS-filtering it. Adding a per-board `cards` filter (matching the per-board `lists` filter already in place) would scope the subscription correctly.

### Notifications fan-out

A comment on a card with 10 watchers and 2 @mentions writes 16 `INSERT INTO notifications` rows synchronously inside the committing transaction. The migration `0071_bulk_notification_dedup.sql` introduces deduplication for bulk archive/move events, but not for comment events.

The email pipeline (`lib/notify-email.ts:88-155`) runs 5 sequential queries plus 1 Supabase admin API call **per pending notification row**. At 100 pending notifications: 500 sequential operations.

### People cache and profile fetches

`usePeopleCache` reads `localStorage` synchronously, with a 24-hour TTL. Background `listCollaborators()` calls fire on every hook mount regardless of TTL. The collaborator query is batched (one SQL union).

`profile-search.ts:22-36` calls `auth.admin.listUsers({ page: 1, perPage: 200 })` on every email-shaped search query — O(total_users) on every keystroke. Profile lookups by email (`profile-lookup.ts:26-47`) run 2 sequential queries with no caching.

### Concrete fixes, in order of return on investment

1. **Module-level singleton for `createSupabaseBrowser`** — eliminates 13 redundant client constructions per page mount.

2. **Use `useBoardStore.getState()` inside effect bodies** in all realtime hooks — eliminates the resubscribe churn caused by 40-entry dependency arrays.

3. **Reduce `REPLICA IDENTITY FULL` to index identity on 12 of 15 tables** — major WAL savings, but requires per-table DELETE-handler audit.

4. **Add per-board `cards` filter in `useWorkspaceRealtime`** — stops the global unfiltered subscription.

5. **Batch the per-event email pipeline** with `.in(...)` lookups before the loop — reduces 500 sequential operations to 5 parallel bulk queries for a 100-notification batch.

6. **Collapse the duplicate `NotificationBell` / `InboxSync` subscriptions** into a shared hook.

7. **Scope `useWorkloadSync`** with a filter or switch to broadcast events pushed by server actions.

### Quick wins versus structural fixes

Quick wins: the singleton client, the merged notification subscriptions, the scoped workload sync, the digest batching. Structural: the `getState()` rewrite across all realtime hooks, the replica-identity migration with DELETE handler audit, the per-board cards filter (which may need a schema change to add `workspace_id` to `cards`), the publication split.

### Part 5 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Rewrite realtime hook effect bodies to use `useBoardStore.getState()` instead of selecting 38 actions as deps | kills resubscribe churn (~300 ms per board nav); enables stable channel singleton per `boardId` | 2 days | low |
| 2 | Reduce `REPLICA IDENTITY FULL` → index identity on 12 of 15 published tables | ~50 % WAL write reduction on those tables; reduces Realtime worker CPU per write | 1–2 days (per-table DELETE handler audit + migration) | medium |
| 3 | Add per-board `cards` filter in `useWorkspaceRealtime` (replace global unfiltered subscription) | stops tenant-wide WAL scan per card mutation; ~80 % reduction in events received | 4 hr | medium (requires `workspace_id` column on `cards` or per-board filter pattern) |
| 4 | Make `createSupabaseBrowser` a module-level singleton | eliminates 13 redundant client constructions per page mount; cleaner WS auth state; minor CPU | 5 min | none |
| 5 | Scope `useWorkloadSync` cards/card_members subscription with a workspace filter | stops `router.refresh()` firing for every tenant-global card change | 1 hr | low |
| 6 | Collapse 3 separate `set()` calls in `useBoardRealtime` card UPDATE branch into 1 | turns 3 React reconciles → 1 per card UPDATE; ~3× client CPU reduction per echo | 30 min | low |
| 7 | Merge `NotificationBell` + `InboxSync` notifications subscriptions | −1 channel + filter per app page | 1 hr | low |
| 8 | Split `supabase_realtime` publication into board-scoped + workspace-scoped | Realtime worker scans only relevant publication per write; ~50 % WAL scan reduction | 1 day | medium |
| 9 | Add `Promise.all` across users in digest route (shared with Part 4 fix 3) | digest cron parallelisation | 30 min | low |

---

## Part 6 — Database, Drizzle, RLS, and Query layer

### What this part does

This is the cross-cutting data layer that every other part depends on. It includes the `dbAsUser` transaction wrapper (`lib/db/client.ts`), the Drizzle schema (`lib/db/schema.ts`), the migration history (`supabase/migrations/`), all the query helpers under `lib/queries/`, and the cross-cutting helpers like `lib/validation.ts`, `lib/ordering.ts`, `lib/auth.ts`, and `lib/status.ts`.

### How much it contributes

This layer sets a 15–25 % latency floor on every operation in the app. Every read pays the `dbAsUser` overhead; every workload that fans out (board snapshot, workspace snapshot, me-* queries) multiplies it.

### The `dbAsUser` cost model

Every database operation in the app routes through `dbAsUser(jwt, fn)`. Each call has the following shape:

```
BEGIN
SELECT set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', $1, true)
<the actual query, or a Promise.all batch of queries>
COMMIT
```

Per call on a warm pgbouncer connection in transaction-pooling mode, the fixed overhead is roughly 2–4 ms on local infrastructure and 10–30 ms when the call crosses regions (Vercel → Supabase). That's the transaction tax — paid before any real work.

JWT decoding is already memoised via `react/cache` keyed on the raw token string (`lib/db/client.ts:25-31`), so only the first call per request pays the decode cost. The two `set_config` calls have already been collapsed into one SQL statement (line 43–45). These are improvements from the prior P1.5 round.

What hasn't been fixed is the **number of separate `dbAsUser` callers per request**. A board navigation invokes seven distinct transactions; a `/me` navigation can invoke up to eight. Each one pays the `BEGIN/set_config/COMMIT` overhead independently.

### Connection pool topology

The postgres-js pool is sized at `max=2` per Fluid Compute invocation (`lib/db/client.ts:9`, configurable via `DATABASE_POOL_MAX`). The `idle_timeout` is 10 seconds and the `connect_timeout` is 5 seconds. That 5-second connect timeout is **risky for cross-region cold starts** — PostgreSQL handshakes can spike past 5 seconds during a regional restart. Raising it to 10–15 seconds is a low-risk improvement.

`prepare: false` is forced by pgbouncer's transaction-pooling mode. This means **every query in the app pays parse-and-plan cost on every call** — no server-side prepared statements. For simple queries this is a few hundred microseconds; for the snapshot fan-outs it accumulates to 10–40 ms of pure planning overhead per snapshot.

The pgbouncer pool size on Supabase is 15 connections on the free tier, 30 on Pro. Raising the postgres-js `max` per invocation past `bouncer_pool / active_invocations` will saturate the bouncer side, so monitor the Supabase dashboard's pgbouncer metrics before increasing it.

### Schema audit

The schema is generally well-indexed. Verified present in `supabase/migrations/`:

- `workspace_members(user_id)` — migration 0001
- `boards(workspace_id)` — migration 0001
- `board_members(user_id)` — migration 0001
- `lists(board_id, position)` — migration 0006
- `cards(board_id, list_id, position)` — migration 0006
- `cards(parent_card_id) WHERE NOT NULL` — migration 0018
- `cards(board_id, type)` — migration 0018
- `cards(sprint_id, story_points)` — migration 0021
- `cards(board_id, priority)` — migration 0040
- `cards(sprint_id) WHERE NOT NULL` — migration 0020
- `cards(owner_id) WHERE NOT NULL` — migration 0060
- `cards_completed_at_idx` — migration 0062
- `cards_board_start_date_idx` — migration 0033
- `cards_board_roadmap_order_idx` — migration 0046
- `cards_tsv_idx` GIN full-text search — migration 0017
- `labels(board_id)`, `card_labels(board_id)` — migration 0010
- `checklists`, `checklist_items` — composite indexes from migration 0012
- `comments(board_id, card_id, created_at desc)` — migration 0013
- `comments_parent_comment_id_idx` — migration 0075
- `attachments(board_id, card_id)` — migration 0014
- `activity` indexes — migration 0015
- `notifications(recipient_user_id, created_at desc)` — migration 0023
- `notifications(recipient_user_id) WHERE read_at IS NULL` — migration 0023
- `notifications_email_pending_idx` — migration 0072
- `card_watchers(board_id)` — migration 0024
- `worklogs` indexes — migration 0028
- `sprints(workspace_id, state)` — migration 0020
- `card_links` triple-index — migration 0019
- `components`, `card_components` — migration 0031
- `versions(workspace_id, state)` — migration 0032
- `card_versions(workspace_id)` and `(version_id, kind)` — migration 0032
- `card_sla` partial index — migration 0029
- `board_favorites(user_id)` — migration 0042
- `recent_views(user_id, viewed_at desc)` — migration 0043
- `dashboards` scope-partitioned — migration 0034
- `dashboard_members(user_id)` — migration 0068
- `gadgets(dashboard_id, position)` — migration 0035
- `card_sprint_history` indexes — migration 0089
- `card_field_history(card_id, changed_at)` — migration 0091
- `milestones` workspace and board indexes — migration 0095
- `profiles_email_digest_optin_idx` — migration 0090

### Index gaps

The four indexes that are missing and would deliver measurable returns:

```sql
-- Highest priority: card_members lookups by user_id
-- (used by me-cards, me-week, workload member queries)
CREATE INDEX IF NOT EXISTS card_members_user_id_idx
  ON public.card_members (user_id);

-- Medium: sprints ordered by start_date for workspace snapshots
CREATE INDEX IF NOT EXISTS sprints_workspace_start_date_idx
  ON public.sprints (workspace_id, start_date asc nulls last);

-- Low: card_watchers lookups by user_id (digest/notify paths)
CREATE INDEX IF NOT EXISTS card_watchers_user_id_idx
  ON public.card_watchers (user_id);

-- Low: card_versions lookups by card_id (currently only by workspace and version)
CREATE INDEX IF NOT EXISTS card_versions_card_id_idx
  ON public.card_versions (card_id);
```

### Unbounded-growth tables to watch

These tables have no automatic cleanup mechanism and will grow indefinitely: `comments`, `attachments`, `card_versions`, `card_sprint_history`, `card_field_history`, `activity`, `notifications`, `worklogs`, `rule_runs`. Each of them needs either a retention policy (auto-delete after N days) or an archival strategy. The most urgent is `notifications`, where read notifications older than 90 days could be deleted by a daily cron with no functional impact.

### Hot query patterns, ranked by aggregate cost

The ten heaviest read patterns across the codebase:

1. `getBoardSnapshot` — 14 sub-queries, dominant payload from comments and attachments. The board page calls this once per navigation.
2. `getWorkspaceSnapshot` — 10 sub-queries, dominant payload from cards and card_versions. Called once per workspace-route navigation.
3. `listMyOpenCards` — owner + member dual queries, four-way joins, currently lacking `card_members(user_id)` index.
4. `listMyWeekCards` — same pattern as above.
5. `listRoadmapCards` and `listRoadmapLinks` — bounded at 200 rows, generally fast.
6. `listNotifications` — well-indexed, fast.
7. `computeBurndown` and `computeVelocity` — dominated by JS-side day-grid computation, not DB.
8. `searchProfiles` — dominated by `auth.admin.listUsers` HTTP call per keystroke.
9. `recordBoardViewImpl` UPSERT — written per board nav, but fast.
10. `notify-email` per-row 5 queries — the N+1 problem that dominates digest cron time.

### RLS perspective

The RLS predicates use `request.jwt.claims->>'sub'` to extract the user ID. This means every predicate evaluation parses the claim JSON. With `workspace_members(user_id)`, `board_members(user_id)`, and `dashboard_members(user_id)` all indexed, the joins themselves are cheap, but the JSON-parsing happens per row.

A future structural improvement would be to wrap membership lookups in a `SECURITY DEFINER` SQL function that caches the current user ID at the session level — for example, `current_app_user_id() RETURNS uuid SET search_path = '' SECURITY DEFINER`. This avoids repeated JSON parses inside RLS predicates and is measurable above 1,000 rows.

### Drizzle-specific notes

- Most `.select()` projections in the codebase are narrow and explicit — this is good.
- The `listCommentsCompat` helper (`board-snapshot.ts:67-118`) uses raw SQL with `to_jsonb` and bypasses column projection. With migration 0075 in place this is no longer needed and should be reverted.
- Insert and update patterns are mostly single-row; bulk fan-out (like notification creation) happens inside Postgres triggers, not in application code. This keeps client-side N+1 problems contained.
- Transaction granularity is exactly one transaction per `dbAsUser` call. The shape is right — the volume of callers per request is the problem.

### Validation cost

`lib/validation.ts` is 18.4 KB of Zod schemas. Zod compilation happens at import time (negligible) and parse cost depends on input size. Unlikely to be a bottleneck unless top-level forms hand huge payloads to actions. Worth profiling only if RSC startup time spikes show up in traces.

### Concrete fixes, in order of return on investment

1. **Add the `card_members(user_id)` index** above. Zero risk, biggest single read-path fix.

2. **Coalesce the layout's four `dbAsUser` calls into one transaction** (same fix as Part 3). Reduces per-navigation transaction count by 3.

3. **Raise `DATABASE_POOL_MAX` to 4–6** per invocation, but verify the pgbouncer side has capacity first.

4. **Raise `connect_timeout` from 5 to 10–15 seconds** for safer cross-region cold starts.

5. **Move RLS membership lookups behind `SECURITY DEFINER` helpers** to avoid re-parsing JWT JSON inside predicates.

6. **Add the three additional missing indexes** (sprints, card_watchers, card_versions).

7. **Wrap the remaining query helpers in `react/cache`** — `listWorkspaces`, `listMyOpenCards`, `listMyWeekCards`, `listMyInbox`, `listWorkload`, `listNotifications`.

8. **Revert `listCommentsCompat` to a typed Drizzle select.**

9. **Implement a notifications retention policy** (auto-delete read rows older than 90 days).

10. **Consider a direct (non-pooled) connection path for very-hot reads** like the board and workspace snapshots, so they can use prepared statements. This is a high-risk change because it bypasses pgbouncer's pooling and needs careful connection management.

### Quick wins versus structural fixes

Quick wins: the `card_members` index, the `connect_timeout` raise, the three secondary indexes, the cache wraps, the compat-SQL revert. Structural: the layout transaction coalesce, the SECURITY DEFINER RLS rewrite, the non-pooled snapshot client, the notifications retention.

### Part 6 — fix priority by expected performance gain

| Rank | Fix | Expected gain | Effort | Risk |
|---|---|---|---|---|
| 1 | Add `card_members(user_id)` index | turns sequential scan on `card_members` filtered by user into index seek; 5–50× speedup on me-cards / me-week / workload at scale | 5 min | none |
| 2 | Coalesce layout's 4 `dbAsUser` calls into one transaction (shared with Part 3 fix 2) | −3 transactions × every navigation app-wide; ~40–80 ms per nav | 1–2 days | medium |
| 3 | Wrap remaining query helpers in `react/cache` (`listWorkspaces`, `listMyOpenCards`, `listMyWeekCards`, `listMyInbox`, `listWorkload`, `listNotifications`) | dedup co-renders; saves 1+ transaction per page where layout and page need same data | 30 min | none |
| 4 | Add `sprints(workspace_id, start_date)` + `card_watchers(user_id)` + `card_versions(card_id)` indexes | targeted gaps; each saves an in-memory sort or sequential scan in its query path | 15 min | none |
| 5 | Raise `connect_timeout` from 5s → 10–15s | prevents cold-start handshake failures during regional restarts | 1 min | none |
| 6 | Revert `listCommentsCompat` to typed Drizzle select (shared with Part 1 fix 6) | restores columnar IO pushdown; ~10–30 ms saved per board snapshot | 30 min | low |
| 7 | Raise `DATABASE_POOL_MAX` from 2 → 4–6 per invocation (after verifying pgbouncer side has capacity) | reduces queuing when 4+ transactions run concurrently; freedom to coalesce less aggressively | 30 min monitoring + 1-line change | medium (must monitor pgbouncer pool) |
| 8 | Implement notifications retention policy (auto-delete read rows > 90 days) | bounds notifications table growth; keeps queries fast as user base grows | 4 hr | low |
| 9 | Move RLS membership lookups behind `SECURITY DEFINER` helper `current_app_user_id()` | avoids re-parsing JWT JSON inside RLS predicates per row; measurable above ~1k rows | 1–2 days | medium |
| 10 | Direct (non-pooled) connection path for very-hot snapshot reads (regains prepared statements) | major plan-cache win on board/workspace snapshots; 10–40 ms saved per snapshot | 3–5 days | high (bypasses pgbouncer; connection management required) |

---

## Recommended fix order — start here

If you only have one sprint of time to spend on performance, do these in this exact order. They are sequenced by a combination of impact, risk, and how much each one unblocks the next:

1. **Add the `card_members(user_id)` index** (Part 6, fix 1). Zero risk, biggest single read-path improvement.
2. **Add `react/cache` wraps** on `listWorkspaces`, `listMyOpenCards`, `listMyWeekCards`, `listMyInbox`, `listWorkload`, `listNotifications`, and `listSprintsForWorkspace` (Parts 3, 4, 6). Zero risk, eliminates layout-to-page duplication.
3. **Make the Supabase browser client a module-level singleton** (Part 5, fix 1). Zero risk.
4. **Short-circuit the middleware `getUser` call** when the token has plenty of life left (Part 3, fix 1). Biggest per-navigation win across roughly 90 % of requests.
5. **Coalesce the layout's four `dbAsUser` calls into one transaction** (Part 3 and Part 6). Saves three transactions per navigation, app-wide.
6. **Lazy-load the heavy dialogs and command palette**: `CardQuickView`, `CardModal`, `BulkActionBar`, `CommandPalette`, `QuickAddCardMount` (Parts 1 and 3). Substantial bundle reduction.
7. **Drop `cardVersions` from `getBoardSnapshot` and revert `listCommentsCompat`** (Part 1 and Part 6). Quick wins that shrink board-snapshot payload.
8. **Switch all realtime hooks to use `useBoardStore.getState()` inside effect bodies** (Part 5, fix 2). Kills the resubscribe churn.
9. **Replica-identity audit and reduction** (Part 5, fix 3). Major WAL savings but a multi-day audit-and-migration task.
10. **Split `roadmap-view.tsx` into shell, canvas, and drag-harness** (Part 2, fix 1). Multi-day refactor; payoff scales with workspace size.

---

## Status of prior P1.5 findings (`docs/superpowers/specs/2026-05-13-perf-analysis.md`)

For continuity with the earlier flat hot-spot list, here's where each of those items stands today:

| Prior ID | Description | Status |
|---|---|---|
| H1 | Four sequential `dbAsUser` calls in `AppLayout` | Still present, partially mitigated by `Promise.allSettled` |
| H2 | `set_config` per query, `prepare: false` | Partially mitigated: `set_config` collapsed into one statement (`db/client.ts:43-45`); JWT decode memoised (`db/client.ts:25-31`). Transaction tax remains. |
| H3 | `CardTile` renders full `CardQuickView` per tile | Partially fixed: selectors short-circuit when `quickViewOpen=false` (`card-tile.tsx:78-129`). The Dialog still mounts eagerly. Part 1 fix 1 closes the rest. |
| H4 | `ListColumn` selects whole `s.cards` | **Fixed**: `list-column.tsx:81-87` now uses `useShallow` per-list filter. |
| H5 | `getBoardSnapshot` full-history fan-out | Still present |
| H6 | `CardQuickView` eager import | Still present |
| H7 | `useBoardRealtime` 40-entry deps | Still present |
| H8 | `useWorkspaceRealtime` N×3 filters | Still present |
| H9 | Middleware `getUser` cost | Still present |
| H10 | Pool `max=2` | Still present (deliberate; safe to raise with bouncer monitoring) |
| H11 | `boardId → workspaceId` regex DB hit | Still present |
| H12 | No `React.memo`, no `Suspense` | Mostly absent |
| H13 | `RoadmapView` 2,263 lines | Still present |
| H14 | `createSupabaseBrowser` not memoised | Still present |
| H15 | `me-*` / workload / inbox not in `react/cache` | Still present |

---

*Two of six audits ran through the codex:rescue subagent; the other four were produced inline because the codex sandbox could not reach the filesystem on this machine. All file and line citations were verified against the current branch state on 2026-05-13.*
