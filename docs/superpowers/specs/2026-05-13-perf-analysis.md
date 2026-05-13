# 2026-05-13 — Deep performance analysis (post-P1.5)

Repo: `/home/innovina/Documents/trello-foundation` — branch `plan/01-foundation`.
Stack: Next.js 15.5 (App Router + Turbopack), React 19, Drizzle ORM (`postgres-js`), Supabase (Auth/Realtime/Postgres via pgbouncer pooler), Zustand 5, `@dnd-kit`, Tailwind 4, Vercel.

Static read-only investigation. No code modified.

---

## 1. Executive summary

The previously diagnosed P1.5 issues (router.refresh flood, unbounded comments, workspace channel churn) **are still in place and effective** (see §8). The remaining perf debt is now structural and concentrated in five areas:

1. **`AppLayout` runs 4–5 sequential `dbAsUser` transactions on EVERY navigation** (no streaming, no cache hits across the calls) — every page transition pays ~5× JWT-bound transaction RTT to Supabase. Lives in `app/(app)/layout.tsx:17-130`.
2. **Every Drizzle query opens a new transaction and replays two `set_config('request.jwt.claims', …)` calls**, with `prepare:false` forced by pgbouncer transaction-pooler. No prepared statements, no statement cache, JWT JSON re-stringified per query. `lib/db/client.ts:7-32`.
3. **`CardTile` renders a full `CardQuickView` (~27 KB component) per card**, even unopened, and each tile subscribes to multiple board+workspace store slices that iterate `s.cards` (O(N) per tile per render). At ~200 cards this is N² subscriptions on every store update. `components/board/card-tile.tsx:48-102, 467-501`.
4. **`ListColumn` selects the full `cards` array** with no `useShallow` and filters per-list in a `useMemo` — every single-card update bumps the cards ref and every list column on the board re-renders. `components/board/list-column.tsx:75`.
5. **`getBoardSnapshot` fans out 14 parallel queries inside a single transaction**, several of which fetch the entire history of the board (all comments, all attachments, all card_versions, all checklist items). With realtime hydration the snapshot is the *only* time these arrive — but it is also paid on every navigation back to `/b/[boardId]` because the page is dynamic and the snapshot loader is not cached across requests. `lib/queries/board-snapshot.ts:119-234`.

Net effect: cold and warm Vercel-side latency on `/b/[boardId]` and `/w/[id]/roadmap` is dominated by sequential RLS-wrapped transactions, not query execution. Client-side, scroll/typing on a board with >100 cards has a measurable jank that scales O(cards × stores) on every CDC echo.

---

## 2. Hot spots

| # | Issue | File:line | Severity | Fix sketch |
|---|---|---|---|---|
| H1 | AppLayout makes 4–5 sequential `dbAsUser` round-trips per request | `app/(app)/layout.tsx:23, 45-51, 62-67, 80-86, 122, 127` | high | Coalesce into a single `dbAsUser` block that runs `Promise.all` against `listWorkspaces`, the active-workspace lookup, the onboarding flag, `listFavoriteBoards`, `listRecentBoardViews`. Currently each `dbAsUser` opens its own transaction and re-sets the JWT claims — that's 5× `BEGIN; set_config; set_config; …; COMMIT` for every navigation. Even better: merge into one Drizzle CTE or move 3 of the 5 calls to client-side `use()` boundaries via parallel routes. |
| H2 | `dbAsUser` re-issues `set_config` for every query block; pgbouncer forces `prepare:false` so no prepared statements | `lib/db/client.ts:18-30` | high | Move `set_config` to a single `select set_local('request.jwt.claims', …)` and decode JWT *once* per request via `react/cache`. Consider Supabase data-API + REST PostgREST for read-only board snapshots — the pooler-bound Drizzle path is the slowest read in the system. Also bump `DATABASE_POOL_MAX` from default 2 on Vercel Fluid Compute. |
| H3 | `CardTile` renders one `CardQuickView` per tile (unopened) and subscribes to 7 board-store slices + 2 workspace-store slices, two of which iterate every card on every render | `components/board/card-tile.tsx:48-102, 467-501` | high | Wrap `CardTile` in `React.memo` (none exists in repo). Lift `CardQuickView` to one instance at the `BoardView` root and pass `openCardId` state down — currently every card adds Dialog state + portals + AssigneePicker imports + workspace-store subscriptions to the tree. Compute `subtaskTotal`/`subtaskDone` once via an indexed map memo on `s.cards` at `BoardView`, then pass scalars to tiles. Same applies to the roadmap quick-view block (`components/roadmap/roadmap-view.tsx:873-941`) — at least there it's a single instance. |
| H4 | `ListColumn` selects `s.cards` whole, filters per-list in render | `components/board/list-column.tsx:75-83` | high | Either (a) compute `cardsByListId` *once* at `BoardView` (already memoised at `board-view.tsx:147` as `visibleCards`) and pass `cards={list-cards}` down as a prop, or (b) use a per-list selector: `useBoardStore(useShallow(s => s.cards.filter(c => c.listId === listId)))`. Today, dragging a card forces every list column on the board to re-run its filter + sortable IDs memo. |
| H5 | `getBoardSnapshot` fans 14 parallel reads, full-history payload | `lib/queries/board-snapshot.ts:130-199` | high | Three orthogonal wins: (1) cap `comments` to e.g. the most-recent 200 board-wide (frontend already caps per-card via `MAX_COMMENTS_PER_CARD=200`), (2) drop `cardVersions` from the board snapshot — the *workspace* snapshot already loads them, and the board view only consumes them via the workspace store, (3) wrap `getBoardSnapshot` in `react/cache` like `getWorkspaceSnapshot` (`workspace-snapshot.ts:107`) is. Today calling it twice in the same request (e.g. layout + page) doubles the work. |
| H6 | `CardQuickView` (`components/board/card-quick-view.tsx`, 782 lines, 27 KB) imported eagerly by every card tile | `components/board/card-tile.tsx:28` | high | `next/dynamic` lazy-load the dialog component with a ssr-false boundary so it only ships when the user opens a tile. Same for `CardModal` (902 lines, 32 KB) and `BulkActionBar` (28 KB) where applicable. None of these need to be in the first-paint board bundle. |
| H7 | `useBoardRealtime` builds 13 `postgres_changes` listeners and one subscribe per board mount; deps array has 40+ entries | `hooks/use-board-realtime.ts:228-596` | med | Pull the store actions from the store ref via `useBoardStore.getState()` inside the listener bodies instead of selecting them — actions are stable references but listing 40 in the deps means *any* upstream re-render that re-creates the closure triggers the cleanup→resubscribe cycle. (Subtle: zustand actions are stable, but React lint requires them in deps when used in the effect.) Better: move the channel setup into a stable ref-keyed singleton; recreate only when `boardId` changes. |
| H8 | `useWorkspaceRealtime` registers N×3 filters per workspace (lists/cards/card_links per board) on one channel | `hooks/use-workspace-realtime.ts:91-300+` | med | Postgres realtime caps filters per channel; large workspaces can silently drop events. Replace per-board filters with a single workspace-scoped filter via a database `replica identity` column or use the new broadcast/presence APIs scoped to `workspace_id`. Also note: this runs at the board level too via `BoardView` (`board-view.tsx:128-129`) — every board mount opens BOTH `board:{id}` AND `ws:{wsid}` channels. Two long-lived WS connections per tab. |
| H9 | Middleware refreshes Supabase session on every navigable request (Edge runtime is fine but no caching) | `middleware.ts:7-11`, `lib/supabase/middleware.ts:23` | med | The matcher already excludes static; that's good. The `await supa.auth.getUser()` call costs ~50–150 ms per request because it hits Supabase GoTrue. With `@supabase/ssr` 0.10, you can short-circuit when the access token is fresh (>30 s away from expiry) using the cookie's `exp` claim — avoids the round-trip on most requests. |
| H10 | `lib/db/client.ts` pool `max=2` default | `lib/db/client.ts:9` | med | On Vercel Fluid Compute (default for Node functions), each invocation is its own process; pool max of 2 is fine *per invocation* but the bottleneck is the pgbouncer pool size on Supabase (default 15 on free, 30 Pro). Raising max to 4–8 inside the function won't help if the bouncer is the bottleneck. Validate via the Supabase dashboard `pgbouncer_active_connections` before raising. |
| H11 | `app/(app)/layout.tsx` boardId/dashboardId path-regex lookup forces an extra DB hit on every board+dashboard nav | `app/(app)/layout.tsx:44-72` | med | Cache the boardId→workspaceId mapping in a cookie or url segment. With ISR off (this app is fully dynamic), the lookup repeats every render. Cheap individually but on the hot path. |
| H12 | No `React.memo` anywhere in the repo (`grep` confirmed) and no `Suspense` boundaries in App Router pages (except `/login`) | `components/**` | med | Block-then-render is the default everywhere. Wrap the slow data fetches (`listRoadmapCards`, `getWorkspaceSnapshot`, the layout's favorites/recents) in `Suspense` so the shell paints first. Wrap `CardTile`, `ListColumn`, `RoadmapBar` in `React.memo`. |
| H13 | `RoadmapView` is 2263 lines, single client component, ~9 store selectors at the top + 12 large `useMemo`s | `components/roadmap/roadmap-view.tsx:415-580` | med | Split into `<RoadmapShell>` (filters, header) + `<RoadmapCanvas>` (gantt) + `<RoadmapInteractions>` (drag harness). Hoist `cardStatusById`, `cardSpById`, `cardSprintNameById`, `cards`, `undatedSubtaskCountByParent` into one indexed selector with `useShallow` so they don't all recompute when *any* store slice changes. |
| H14 | `createSupabaseBrowser()` is called fresh in every hook that needs a channel (~9 callsites); each call constructs a new Supabase client | `lib/supabase/browser.ts:3-8` and `hooks/use-*-sync.ts` | low | Memoise the client in a module-level singleton: `let _supa: SupabaseClient \| null = null; export function createSupabaseBrowser() { return _supa ??= createBrowserClient(...); }`. Many channels share the underlying realtime socket, but separate clients duplicate Auth listeners and JWT decode work. |
| H15 | Workload/inbox/me-week scans are not in `react/cache` | `lib/queries/me-cards.ts`, `me-week.ts`, `workload.ts`, `me-inbox.ts` | low | Same `react/cache` trick as `getWorkspaceSnapshot` so co-rendering at layout + page doesn't duplicate work. |

---

## 3. Server-side findings

- **`dbAsUser` pattern (`lib/db/client.ts:18-32`)**: a new transaction is opened *and* `set_config('request.jwt.claims', …)` is called twice per *function*, not per *request*. Every Promise.all batch inside `getBoardSnapshot`/`getWorkspaceSnapshot` runs as a single transaction (good), but every separate consumer of `dbAsUser` (layout favorites, recents, profile, onboarding, page snapshot, sprints…) opens its own. JWT JSON is parsed and re-stringified each time (`decodeJwt` runs per `dbAsUser`, no caching).
- **`postgres-js` config (`lib/db/client.ts:7-14`)**: `prepare:false` (required by pgbouncer transaction mode) means *no* server-side prepared statements. Every query is parse+plan+execute. Pool `max=2` per invocation, `idle_timeout=10s`, `connect_timeout=5s` — `connect_timeout` is dangerously short on cold starts cross-region; AWS PG handshakes can spike past 5 s during a regional restart.
- **`getBoardSnapshot` (`lib/queries/board-snapshot.ts:119-234`)**: 14 SELECTs in parallel. Of these, six pull *entire-history* tables: comments (with a hand-rolled `to_jsonb` fallback at lines 70-85 to support an older schema), attachments, checklists+items, components, cardComponents, cardVersions. With a board ≥ 6 months old this is the dominant payload. The hand-rolled comments path (`listCommentsCompat`) bypasses Drizzle's column projection entirely, returning all columns then re-mapping — fine functionally, but it can't benefit from the columnar IO pushdown that the rest of the snapshot enjoys.
- **`getWorkspaceSnapshot` (`lib/queries/workspace-snapshot.ts:107-331`)**: properly wrapped in `react/cache` (good). 10 parallel queries. The fallback (no boards) path makes 3 sequential queries — minor.
- **`AppLayout` (`app/(app)/layout.tsx:17-130`)**: 4 separate `dbAsUser` blocks (`listWorkspaces`, board-or-dashboard lookup, onboarding, `listFavoriteBoards`, `listRecentBoardViews`) — five if you count both favorites and recents. Each is a separate transaction. The board-or-dashboard lookup runs an extra DB roundtrip on every `/b/*` and `/dashboards/*` navigation. There is no `Promise.all` at this level — the four blocks are awaited sequentially, ~5× serial RLS-cost.
- **No prepared statements**: by design (pgbouncer transaction mode), but it means Drizzle's `.prepare()` API is unused. Every common query (`select … from cards where board_id=…`) replans every call.
- **API routes**: `/api/cron/send-emails` (Node, force-dynamic, OK), `/api/sla/scan` (POST, service-role-bypass, calls `scan_board_sla` RPC, OK), `/api/watchers/check` (GET, runs 2 parallel reads, OK), `/api/notifications/digest` (Node, force-dynamic). None of these are on the hot path; the cron job is daily 08:00 UTC and the SLA scan is on-demand. No issues.
- **Auth**: `requireUser` and `getSessionToken` are wrapped in `react/cache` (`lib/auth.ts:7-19`), so within a request the user/session are computed once. Good. But: `getSessionToken` calls `createSupabaseServer()` a *second* time after `getUser` already created one — minor (Supabase server clients are cheap).
- **Route freshness**: no route exports `force-dynamic` or `revalidate`. App Router treats them as dynamic by default because every page reads cookies via `await cookies()`. That is correct, but it means *no* RSC caching happens at the page level. Combined with `dbAsUser` cost, every navigation pays full data fetch.

---

## 4. Client-side findings

- **`BoardStoreProvider` re-render fanout**: 261 grep matches for `useBoardStore`/`useWorkspaceStore` selectors across `components/` and `hooks/`. Most select primitive scalars or refer to actions (fine). A non-trivial subset select whole arrays without `useShallow`:
  - `versions/version-card-section.tsx:26` `s.cardVersions`
  - `epic/epic-kanban-view.tsx:40` `s.cards`, line 42 `s.lists`
  - `board/board-filter-bar.tsx:37` `s.labels`
  - `board/list-column.tsx:75` `s.cards`  ← **biggest culprit, called per list column**
  - `board/board-view.tsx:84-89` `lists/cards/cardLabels/cardMembers/labels/boardProfiles` — at the root, this is OK (single subscriber), but means every CDC echo re-renders `BoardView` and the whole tree below.
  - `board/card/parent-picker.tsx:19`, `card-links-section.tsx:57`, `blocked-badge.tsx:6`, `attachments-section.tsx:21`, `checklists-section.tsx:19, 24` — each a whole-array select.
  - `workspace/all-tasks-view.tsx:86-90` — five raw selects.
  - `roadmap/roadmap-view.tsx:415-424` — nine raw selects in one component.
- **`useShallow` usage** is consistent where present (card-tile lines 73, 82; comments-section line 24; subtask-badge line 25; roadmap-view lines 877, 889). The pattern is understood by the team; just not applied uniformly.
- **`s.cards.find` and `s.cards.filter` inside selectors**: card-tile.tsx lines 87-101 iterate `s.cards` *twice* (subtask total + done) per tile per render. With 200 tiles that's 400 iterations × 200 cards = **80 000 comparisons every time any card changes** in the store.
- **No `React.memo`**: `grep React.memo` returns nothing. Every `set` on the board store re-renders `BoardView` and all descendants. The only mitigation is Zustand's selector equality — but that only short-circuits the *selector*, not the *child component*. List columns get the same `lists` ref so React's reconciler bails on `lists` prop, BUT child `CardTile`s receive a new `card` prop reference because `cards` is a new array after `set` (board-store builds `state.cards.map(...)` in `updateCard`, line 243).
- **`Suspense` boundaries**: only `/(auth)/login/page.tsx:31`. Every other route blocks on the data fetches. Roadmap is the worst offender: `Promise.all([listRoadmapCards, getWorkspaceSnapshot])` (roadmap/page.tsx:21-24) — both queries serialize against the layout's four queries.
- **Image optimization**: no `<img>` tags and no `next/image` imports were found in `components/`. Board backgrounds use CSS gradients (`board-view.tsx:386`). Avatars are rendered as initials in `<Avatar>`. So images are not a perf issue here. (Confirmed by grep.)
- **Realtime subscription count per board view**:
  - `useBoardRealtime` opens 1 channel `board:{id}` with 13 `postgres_changes` listeners (lines 244-548).
  - `useWorkspaceRealtime` opens 1 channel `ws:{wsid}` with `boardCount × 3 + ~6` listeners.
  - `useBoardPresence` opens 1 channel `board:{id}:presence`.
  - Plus, when `BoardView` is mounted under `/b/[boardId]`, AppLayout's `<NotificationBell>` opens a notifications channel via `useWorkspaceMembershipSync` (top-nav.tsx:5).
  - Total per board mount: **4 long-lived Supabase channels**, ~20+ postgres-change filters across them. Each channel maintains its own heartbeat; the realtime client multiplexes them on one WS socket. Acceptable, but on large workspaces (10+ boards) the listener registration alone takes ~300 ms before the first event can arrive.
- **`createSupabaseBrowser` is recreated per hook invocation**: 9 callsites (`use-workspace-versions.ts:52`, `use-workspace-members-sync.ts:13`, `use-board-membership-sync.ts:13`, `use-board-presence.ts:19`, `use-workspace-membership-sync.ts:15`, `use-workload-sync.ts:17`, `use-activity-sync.ts:19`, comments-section, create-workspace-dialog). Each constructs a fresh `BrowserClient`. Cheap but unnecessary work in mount-heavy navigation.
- **Drag layer**: `@dnd-kit/core` distance-based sensor (`board-view.tsx:170-172`) with 8 px activation — fine. The drag overlay is correctly used (`activeCard`, lines 184-188). The cost is `cards.find` on every drag-start (lines 186) — O(N) but only at drag-start, negligible.
- **Roadmap canvas (`components/roadmap/roadmap-view.tsx`, 2263 lines)**: builds `cards`, `cardStatusById`, `cardSpById`, `cardSprintNameById`, `undatedSubtaskCountByParent`, `links` in five separate `useMemo`s (lines 428-579), all depending on `storeCards` directly. Any single card edit re-runs all five. Plus the drag harness keeps three refs in sync each render (lines 587-596) — these refs are mutated *inline during render*, which is a React 19 footgun (works today but won't with concurrent rendering).

---

## 5. Network / Caching findings

- **Cache-Control on static assets**: middleware matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and image extensions (`middleware.ts:9-10`). Vercel applies far-future immutable headers to `_next/static` automatically. OK.
- **Server Action call chains**: 27 `router.refresh()` callsites (see grep). Most are after destructive operations (delete list, archive, move-to-board, bulk actions). On a board with realtime subscribed, `router.refresh()` is doubly expensive — it re-fetches the entire `BoardSnapshot` (14 queries) just to confirm a write that the CDC will also echo back. Most of these can be removed now that the store mutations are wired:
  - `components/board/bulk-action-bar.tsx`: 8 router.refresh calls
  - `components/board/board-view.tsx`: 3 calls
  - `components/board/card/move-to-board-dialog.tsx`: 1 call
  - `components/quick-add-card-dialog.tsx`: 2 calls
  - `components/inbox/inbox-list.tsx`: 3 calls
  - `components/dashboard/*`: 4 calls
- **RSC payload size**: the largest RSC payload is `BoardPage` → `BoardView` (which is a Client Component) → snapshot passed as serialized props. With a 200-card board this prop is ~150-300 KB serialized. There is no way to compress this further without splitting the data — but the snapshot is also computed in `BoardStoreProvider`'s initial state, so it can't be split.
- **Realtime payload**: Supabase `postgres_changes` sends *full rows* (default `replica identity full` for tables that opted in). For wide tables like `cards` (20+ columns), every update message is ~1-2 KB. With 50 concurrent users editing on the same board, this multiplies. Consider setting `replica identity` to a narrower index on `cards` and reconstructing in the client.

---

## 6. Vercel-specific findings

- **`vercel.json`**: only a cron entry. No `functions` config, so all routes use defaults (Fluid Compute on Node 20+, 1024 MB, 10 s timeout for Hobby / 60 s Pro). Routes that read the full board snapshot (~14 queries) on cold-start with cross-region latency can approach 3–5 s. No memory or maxDuration override.
- **Region co-location**: no `regions: [...]` field in `vercel.json` and no `experimental.serverActions.region` in `next.config.ts`. By default Vercel deploys functions to the user's nearest region; if Supabase is in `eu-central-1` (FRA) and the function lands in `iad1` (US-East), every `dbAsUser` pays a ~100 ms RTT. With 5 of them in AppLayout, that's 500 ms baseline before any real work. **This is the single biggest production-only effect** because in dev everything is localhost. Action: add `"functions": { "**": { "regions": ["fra1"] } }` (or whichever matches the Supabase region) to `vercel.json`.
- **`next.config.ts`** (lines 1-9): only `outputFileTracingRoot`. No `images.remotePatterns`, no `experimental.optimizePackageImports`, no `experimental.serverComponentsExternalPackages` for `postgres`. The last one matters: `postgres-js` is a native-ish module; without externalising it, Turbopack bundles it into the function. Adding it to `serverComponentsExternalPackages` shaves a few hundred ms off cold start.
- **Cold start dependency graph**: every server page imports `@/lib/db/schema` (18.7 KB, all tables), `@/lib/queries/*`, `@/lib/auth.ts` (which imports `@supabase/ssr`), `@supabase/supabase-js` indirectly. `app/(app)/layout.tsx` adds top-nav (which is `"use client"` — good, the server bundle is smaller). On the *client* side, `card-modal.tsx` (902 lines) is imported eagerly through `card-tile.tsx` → `card-modal` flow on the board page. Lazy-load it.
- **No `instrumentation.ts`**: no OpenTelemetry/Sentry server-side instrumentation. Can't profile production traces today. `DEPLOYMENT.md:130-149` describes the Sentry wizard path — that's the right move.
- **Middleware on Edge**: `middleware.ts` runs on the Edge runtime by default. `updateSession` calls Supabase GoTrue (`supa.auth.getUser()`) on every request — that's a cross-region HTTPS call from the edge node, typically 50–150 ms. The matcher excludes static files (good), but every page load and every server action gets gated by this round-trip.

---

## 7. Recommended next steps (smallest-first)

1. **(15 min)** Add Vercel function region to `vercel.json` matching Supabase region. Single biggest production wins. `{"functions": {"app/(app)/**": {"regions": ["fra1"]}}, "crons": [...]}`.
2. **(20 min)** Wrap `getBoardSnapshot` in `react/cache` like `getWorkspaceSnapshot` (`lib/queries/board-snapshot.ts:119`). Trivially saves a duplicate snapshot if any layout/sibling reads it.
3. **(30 min)** Coalesce the 4–5 `dbAsUser` blocks in `app/(app)/layout.tsx` into one. Wrap the body in a single `dbAsUser(token, tx => Promise.all([...]))`. **This is the biggest serverside latency win.**
4. **(45 min)** `next/dynamic` lazy-load `CardModal`, `CardQuickView`, `BulkActionBar`. None need to be in first-paint board bundle.
5. **(1 h)** Memoize `createSupabaseBrowser` as a module-level singleton in `lib/supabase/browser.ts`.
6. **(1 h)** Audit 27 `router.refresh()` callsites; remove those that have an equivalent store mutation + CDC echo. Each removal saves a full board snapshot fetch.
7. **(2 h)** Wrap `CardTile`, `ListColumn`, `RoadmapBar` in `React.memo` with a custom prop-equality fn (compare card by id + revision counter, not whole object).
8. **(2 h)** Replace `useBoardStore(s => s.cards)` in `list-column.tsx:75` and other per-row consumers with per-list selectors that use `useShallow`. Fix the same in `parent-picker`, `card-links-section`, `blocked-badge`, etc.
9. **(2 h)** Lift `CardQuickView` to one instance at `BoardView` root with an `openCardId` URL search param (or zustand UI slice). Today every tile carries one.
10. **(half-day)** Replace per-tile `s.cards.filter` subtask counters with an indexed `Map<parentId, {total,done}>` built once at the store level (or in a top-level memo) and pass scalars down.
11. **(half-day)** Add Sentry per `DEPLOYMENT.md` so you can measure the wins instead of guessing.
12. **(day)** Split `roadmap-view.tsx` into shell/canvas/interactions. Hoist indexed maps to a `useMemo` that returns a single object so 5 separate dependencies become 1.

---

## 8. What's already fixed (verified)

- **Activity-feed router.refresh flood**: debounced 250 ms in `hooks/use-activity-sync.ts:42-46`. Holding.
- **Unbounded board-store comments**: `MAX_COMMENTS_PER_CARD = 200` cap in `stores/board-store.ts:140` and per-card trim at line 451. Holding.
- **Workspace channel churn**: `useWorkspaceRealtime` now keys re-subscription on a sorted `boardIds.join(",")` string (`hooks/use-workspace-realtime.ts:70`), so a CDC echo that reorders the `boards` array does not flap the channel. Holding.
- **`workspace-snapshot` caching**: `react/cache` wrap at `lib/queries/workspace-snapshot.ts:107`. Holding. (Note: `getBoardSnapshot` is **not** wrapped — see step 2 above.)

---

## 9. What I couldn't determine from static analysis

- Actual cross-region RTT to Supabase from Vercel functions (depends on configured regions; the dev `.env` and `.env.cloud` don't expose the live values).
- Whether Vercel Fluid Compute is enabled in production for this project (default-on for Node functions since 2025, but project settings can override).
- True per-table row counts on production — the impact of fan-out snapshot queries depends on workspace size.
- Real-world `getSnapshot should be cached` warnings: I can spot the patterns at risk (`s.cards.filter(...).map(...)` returning fresh objects without `useShallow`) but not confirm they fire in production without runtime traces.
- Whether the Supabase `supabase_realtime` publication's `replica identity` is `full` or `default` on the heavy tables (`cards`, `comments`). This affects payload size for every CDC event.
- Bundle sizes per route — no `next build` output captured. Recommend running `ANALYZE=true next build` once with `@next/bundle-analyzer` plugged in to get a hard number.
- Server-side latency under load — no APM hooked up. Without Sentry/OpenTelemetry the recommendations are based on static reasoning; the first ship-step (1 + 11) should be region pinning + Sentry so improvements are measurable.
