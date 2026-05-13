# System Architecture Report — trello-foundation

**Project path:** `/home/innovina/Documents/trello-foundation`
**Branch:** `plan/01-foundation`
**Date generated:** 2026-05-13
**How this was produced:** Five parallel investigation agents (`codex:rescue`), each assigned to a distinct layer of the system. Each agent performed a read-only inspection of source files and returned a Markdown summary. The five summaries were then merged into this single document.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Technology Stack](#2-technology-stack)
3. [End-to-End Request Flow](#3-end-to-end-request-flow)
4. [Frontend — App Routes and Pages](#4-frontend--app-routes-and-pages)
5. [Frontend — Components, Stores, and Hooks](#5-frontend--components-stores-and-hooks)
6. [Backend — Server Actions](#6-backend--server-actions)
7. [Backend — API Route Handlers and Library Services](#7-backend--api-route-handlers-and-library-services)
8. [Data Layer and Infrastructure](#8-data-layer-and-infrastructure)
9. [Recap Tables (Quick Reference)](#9-recap-tables-quick-reference)
10. [Known Gaps and Risks](#10-known-gaps-and-risks)

---

## 1. Executive Summary

The project `trello-foundation` is an internal team-collaboration application: a Trello-style Kanban board combined with a roadmap (Gantt) view, sprint management, dashboards, and notifications. It is built on Next.js 15 (App Router) and React 19, with Supabase providing the database (Postgres 17), authentication, file storage, and realtime change-data-capture. Production deployment targets Vercel for the application and Supabase Cloud for the database.

The system is organized into five clear layers:

1. **Frontend route pages** (`app/`): server-rendered shells that fetch data, seed client stores, and gate access. Every page is a Server Component; no `"use client"` directive appears in any route file.
2. **Frontend interactive components** (`components/`, `stores/`, `hooks/`): Client Components built on Base UI primitives, with state held in two Zustand stores (one for board view, one for workspace view) and live data synced through Supabase Realtime channels.
3. **Server Actions** (`actions/`, 33 files): the primary write path. Every mutation goes through a server action that authenticates the user and forwards the JWT to the database.
4. **API route handlers and library services** (`app/api/`, `lib/`): used only for cron jobs, signed file uploads, and a few client-driven lazy fetches. Domain logic (roadmap layout, workload bucketing, dashboard gadget resolvers) lives in pure-computation modules.
5. **Data layer and infrastructure** (`supabase/`, `lib/db/`, CI, deployment configs): 96 hand-authored SQL migrations define the schema, triggers, and row-level security policies; Drizzle ORM provides a TypeScript query interface; GitHub Actions runs lint, integration, and end-to-end test jobs in parallel.

The single most important architectural decision is that **authorization is enforced by Postgres Row-Level Security (RLS), not by application code.** The helper `dbAsUser(jwt, fn)` runs every database transaction with the caller's JWT injected into `request.jwt.claims`, so RLS policies see the real user. Application-level role checks exist in only one place (sprint management), as defence-in-depth.

The second most important decision is that **real-time data flows through Supabase change-data-capture (CDC), not through WebSocket pub/sub or server-sent events.** Mutations always go through a server action; that action writes to Postgres; Postgres emits a CDC event on the `supabase_realtime` publication; every subscribed client receives the event and updates its Zustand store. Optimistic UI applies the change locally first, and idempotency guards on every store action prevent the CDC echo from re-applying the same change.

---

## 2. Technology Stack

| Concern | Tool | Version | Notes |
|---|---|---|---|
| Web framework | Next.js | 15.5.15 | App Router, Server Components, Server Actions |
| UI runtime | React | 19.1.0 | — |
| Bundler (development) | Turbopack | bundled with Next | `next dev --turbopack` |
| Styling | Tailwind CSS | 4.x | CSS variables only — no `tailwind.config.js`; tokens live in `app/globals.css` |
| Component primitives | `@base-ui/react` | 1.4 | Replaces Radix; shadcn style is `base-nova` |
| Component CLI | shadcn | 4.5 | — |
| State management | Zustand | 5.0 | Two stores: board, workspace |
| Drag and drop | `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3 + 10.0 | Board, roadmap, gadget grid |
| Fractional positioning | `fractional-indexing` | 3.2 | List, card, checklist order |
| Form validation | Zod + React Hook Form | 4.3 + 7.74 | Schemas live in `lib/validation.ts` |
| Toasts | Sonner | 2.0 | Mounted globally in `app/layout.tsx` |
| Icons | Lucide | 1.11 | Configured in `components.json` |
| Auth + realtime client | `@supabase/supabase-js` + `@supabase/ssr` | 2.105 + 0.10 | Used only for auth and realtime; not for data queries |
| ORM | Drizzle | 0.45 | Used for all database reads and writes |
| Database driver | `postgres` (postgres-js) | 3.4 | Connection pool max 2 by default |
| Database | Postgres | 17 | Supabase-managed in production; Docker locally |
| Email provider | Resend (HTTP API) | — | Two delivery paths: per-event and daily digest |
| Unit and integration tests | Vitest | 4.1 | With `@vitest/coverage-v8` |
| End-to-end tests | Playwright | 1.59 | Chromium only |
| Application hosting | Vercel | — | Single cron defined in `vercel.json` |
| Database hosting | Supabase Cloud | — | Project ref `xndddfopnlrzkydtnjxo` |

---

## 3. End-to-End Request Flow

A typical authenticated request follows these steps:

1. **The browser sends a request** to the application URL on Vercel.
2. **Next.js middleware** (`middleware.ts`) intercepts the request. The middleware delegates to `updateSession` (`lib/supabase/middleware.ts`), which refreshes the Supabase JWT cookie if it is near expiry and injects an `x-pathname` header so server components can know which route is being rendered. The middleware does **not** redirect unauthenticated users; that responsibility belongs to the page itself.
3. **A Server Component** (a `page.tsx` or `layout.tsx`) is rendered. The first thing it does is call `requireUser()` from `lib/auth.ts`, which returns the current user or redirects to `/login` if no session exists.
4. **The component fetches data** by calling a helper from `lib/queries/*` (for reads) or a server action from `actions/*` (for writes). Both ultimately go through `dbAsUser(jwt, fn)`.
5. **`dbAsUser` opens a Drizzle transaction** and, before running `fn`, issues a combined `SELECT set_config('role', 'authenticated', true), set_config('request.jwt.claims', <claims>, true)`. This activates Row-Level Security as the caller.
6. **Postgres executes the query**, evaluating RLS policies against the caller's user ID, and returns the rows.
7. **The Server Component finishes rendering** and streams the result to the browser. Page-specific Client Components inside it (the board view, the dashboard grid, etc.) receive the data as props and seed their Zustand stores.
8. **The Client Component subscribes to Supabase Realtime channels** (`board:{boardId}`, `ws:{workspaceId}`, and so on). Before subscribing, it calls `supa.realtime.setAuth(token)` so the realtime server evaluates RLS as the authenticated user.
9. **The user performs an action** (drag a card, add a comment, etc.). The Client Component:
   - Snapshots the previous state.
   - Applies the change locally to the Zustand store (optimistic UI).
   - Calls a server action through `useTransition`.
10. **The server action** calls `requireUser` + `getSessionToken`, then invokes the corresponding `*Impl(token, input)` function, which uses `dbAsUser` to write the change. A Postgres trigger may also fire to record activity, log history, or emit a notification.
11. **The CDC publication** broadcasts the change. Every subscribed client (including the one that originated the mutation) receives the event. The `rowTo*` deserializer in `hooks/use-board-realtime.ts` or `hooks/use-workspace-realtime.ts` converts the snake_case payload into camelCase TypeScript types and updates the Zustand store.
12. **Idempotency guards** on every `add*` action in the store ensure that the CDC echo does not re-apply the same change the client already applied optimistically.
13. **Optionally**, the server action calls `revalidatePath` to invalidate the RSC cache for the next navigation. Some actions deliberately omit this call when CDC handles the live update.

If the server action fails, the Client Component rolls back the local store using the snapshot it took in step 9, displays a toast, and pushes an entry into the `errorBus`.

---

## 4. Frontend — App Routes and Pages

The Next.js App Router groups routes into two top-level segments: `app/(app)` for authenticated routes and `app/(auth)` for sign-in / sign-up. Every page and layout in both groups is a Server Component. No `"use client"` directive appears in any route file; the client boundary is consistently pushed down to leaf components inside `components/`.

### Root infrastructure

`app/layout.tsx` defines the root HTML document. It loads four Google fonts via `next/font` (Geist Sans, Geist Mono, JetBrains Mono, Instrument Serif), sets the global metadata (`title: "Trinno"`), and mounts a single `<Toaster>` (Sonner) for global notifications. No data is fetched here.

`middleware.ts` runs on every request that is not a static asset or image. It calls `updateSession` from `lib/supabase/middleware.ts`, which refreshes the Supabase session cookie and forwards an `x-pathname` header to the rest of the application. It performs no authentication redirects of its own.

`next.config.ts` is minimal: it sets `outputFileTracingRoot` to the project directory so that the Vercel build can correctly trace local file dependencies.

### The authenticated app shell — `app/(app)/layout.tsx`

This layout is the parent of every authenticated page. It is responsible for:

- Calling `requireUser()` to gate access.
- Loading the user's workspaces (`listWorkspaces`), favorite boards (`listFavoriteBoards`), and recent board views (`listRecentBoardViews`).
- Coalescing several small lookups (the current workspace, dashboard owner, and the user's onboarding flag) into a single `dbAsUser` transaction with `BEGIN/SET/COMMIT` in one round trip.
- Running all of these queries through `Promise.allSettled` so that a partial failure does not crash the layout.
- Resolving the active workspace from the `x-pathname` header injected by middleware.
- Mounting the top navigation bar (`TopNav`) and a set of overlay components: `TourOverlay`, `ErrorPane`, `UndoBanner`, `ShortcutsOverlay`, `AccessNotice`, `QuickAddCardMount`, `CommandPalette`.
- Showing the first-run onboarding tour only when the user has at least one workspace and has not yet completed onboarding.

### Root page — `app/(app)/page.tsx`

This is a redirect trampoline: it loads the user's workspaces and immediately redirects to `/w/${workspaces[0].id}`. If the user has no workspaces, it renders an onboarding notice.

### Board routes — `app/(app)/b/[boardId]/`

The board layout fetches the full board snapshot (`getBoardSnapshot`) and the workspace snapshot (`getWorkspaceSnapshot`), then seeds two Client Components: `BoardStoreProvider` and `WorkspaceStoreProvider`. If the board is hidden by RLS (because the user lost membership), the layout redirects to `/?notice=removed` rather than calling `notFound()`.

The board layout accepts a parallel route slot named `@modal`. This slot is filled by `b/[boardId]/@modal/(.)c/[cardId]/page.tsx`, which uses Next.js route interception: when a user clicks a card from within the board view, the URL changes to `/b/<boardId>/c/<cardId>` but the page renders in a dialog overlay instead of replacing the board. Direct navigation to that URL bypasses the interception and renders the same content as a full page (`b/[boardId]/c/[cardId]/page.tsx`). This is the only place in the codebase that uses parallel routes combined with route interception.

The board settings page (`b/[boardId]/settings/page.tsx`) gathers the board snapshot, SLA policies, board membership, and favorite IDs, then renders Client-Component panels for renaming the board, archiving it, managing lists (WIP limits, status mappings), managing SLA policies, managing component labels, and managing board members.

### Workspace routes — `app/(app)/w/[workspaceId]/`

The workspace layout acts as a membership guard: it calls `getWorkspace(token, workspaceId)` and redirects to `/?notice=removed` if RLS hides the row.

The workspace home page (`/w/<id>`) is itself a redirect trampoline — it sends the user to `/w/<id>/roadmap`.

Child pages include:

- **Roadmap** (`roadmap/page.tsx`): renders the Gantt-style workspace roadmap. Loads `listRoadmapCards` and `getWorkspaceSnapshot` in parallel.
- **Boards** (`boards/page.tsx`): renders a thumbnail grid of all boards in the workspace, along with the user's favorites and the "Create board" dialog.
- **Backlog** (`backlog/page.tsx`): the sprint backlog, with drag-and-drop card assignment.
- **Sprint detail** (`sprints/[sprintId]/page.tsx`): the burndown chart and the remaining/completed card lists.
- **Sprint report** (`sprints/[sprintId]/report/page.tsx`): post-mortem analytics for a completed sprint — committed vs completed points, velocity over the last six sprints, per-card flags such as "added mid-sprint" or "carried over".
- **Epic Kanban** (`e/[epicId]/page.tsx`): an epic-scoped Kanban view that shows the epic's direct child cards arranged across its home board's lists.
- **Versions list and detail** (`versions/page.tsx` and `versions/[versionId]/page.tsx`): release version management. The version detail page also exposes a `GET .../release-notes/route.ts` handler that returns Markdown-formatted release notes as a downloadable file.
- **Workspace settings** (`settings/page.tsx`): rename the workspace, toggle the `autoAssignCreator` flag, invite and manage members, and a versions panel.
- **Archive** (`archive/page.tsx`): all archived cards, lists, and boards for the workspace, with restore actions.
- **All tasks** (`all-tasks/page.tsx`): a retired redirect stub. Bookmarks are bounced to `/me`.

### Cross-workspace personal routes

- **`/me`**: a personal dashboard that aggregates data across every workspace the user belongs to. Seven queries run in parallel (`getMyTodayCounts`, `listMyOpenCards`, `listMyWeekCards`, `listMyActiveSprints`, `listMyInbox`, `listMyWatchlist`, `listBlockersOnMyCards`), followed by per-sprint burndown computations.
- **`/me/timeline`**: a personal timeline showing every card assigned to the user (as owner or member) that has both a start date and a target date. Filterable by workspace through the `?ws=` query parameter.
- **`/timeline`**: the cross-workspace timeline for all visible cards (not just the user's).
- **`/workload`**: a cross-workspace people-by-time view showing every user's dated card assignments as swimlanes.
- **`/dashboards`** and **`/dashboards/[id]`**: configurable dashboards built from a fixed set of gadget types (count, recent activity, assigned-to-me, due-this-week, velocity, burndown, cards-by-type, markdown-note, on-roadmap).
- **`/inbox`**: the in-app notification inbox with URL-driven filter chips (`?filter=unread|mentions|comments|due`).
- **`/settings`**: links to the profile page (read-only display of email and user ID) and the notifications preferences page (email digest toggle and per-kind event toggles for eight notification kinds).

### Authentication routes — `app/(auth)/`

These pages have no shared layout. Each one renders its own `<main>` element. The page itself is a Server Component, but the form inside it is a Client Component that calls the Supabase auth client directly.

- `/login`: renders `<LoginForm>` inside a `<Suspense>` boundary so the form can read search parameters client-side without blocking the page shell.
- `/signup`: renders `<SignupForm>`.
- `/forgot-password`: renders `<ForgotPasswordForm>`.
- `/reset-password`: renders `<ResetPasswordForm>` after the user clicks the Supabase-emailed reset link.
- `/auth/callback/route.ts`: a Route Handler that completes the PKCE OAuth/email-confirmation flow. It exchanges the `code` query parameter for a session, then either redirects to `/` or, if a `tr_seed_demo` cookie is present, seeds a demo workspace and redirects to that workspace.

### Internal API routes — `app/api/`

The application has eight internal API routes. They are used for cron jobs, signed file uploads, and a small set of client-driven lazy fetches that do not fit into the Server-Action pattern.

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/card-history` | GET | Lazy-load card field-history and sprint-history rows for the card modal | `requireUser()` + RLS |
| `/api/upload` | POST | Issue a Supabase Storage signed upload URL for card attachments | `requireUser()` + an explicit board-membership check |
| `/api/worklogs` | GET | Worklogs for a card | `requireUser()` + RLS |
| `/api/notifications/recent` | GET | Last 8 notifications plus unread count, for the top-nav bell | `requireUser()` + RLS |
| `/api/notifications/digest` | POST | Daily email digest cron | `x-cron-key` header |
| `/api/cron/send-emails` | GET | Per-event email sender cron | `Authorization: Bearer ${CRON_SECRET}` |
| `/api/sla/scan` | POST | Trigger the `scan_board_sla` Postgres function for a board and revalidate its pages | `Authorization: Bearer ${CRON_SECRET}` |
| `/api/watchers/check` | GET | Returns `{watching, watchers}` for a card; used when opening the modal | `requireUser()` + RLS |

### Key observations about the route layer

- **The authentication boundary is application-layer, not middleware-layer.** Middleware only refreshes the session cookie. The actual unauthenticated-user redirect is `requireUser()` in `lib/auth.ts`, called at the top of every Server Component in `(app)/`. A missed call would silently expose a route, since there is no network-level catch-all gate.
- **All page and layout files are Server Components.** The client boundary is pushed down into leaf components (`BoardView`, `DashboardGrid`, `RoadmapView`, and so on), which maximizes streaming and keeps data fetching on the server without needing an extra fetch layer.
- **Parallel routes and route interception are used exactly once**, for the card modal — to allow clicking a card on the board to open a dialog without a full page transition, while still supporting bookmarkable card URLs.
- **There is no general-purpose REST API.** Almost all data fetching happens inside Server Components through `lib/queries/*` functions; Route Handlers are reserved for client-driven lazy fetches and cron jobs.

### Improvement opportunities — ranked by expected speed / performance gain

| Rank | Fix | Expected gain | Effort | Location |
|---|---|---|---|---|
| 1 | Combine the seven parallel `/me` queries into a single Postgres view (or stored procedure) returning one row per section | 30–50% TTFB improvement on `/me` | Medium | `lib/queries/me.ts` + new migration |
| 2 | Wrap the sprint-burndown computations on `/me` and on the sprint-report page in `<Suspense>` boundaries so they stream after the shell | ~200 ms First Contentful Paint improvement | Low | `app/(app)/me/page.tsx`, `app/(app)/w/[workspaceId]/sprints/[sprintId]/report/page.tsx` |
| 3 | Join card → board → workspace lookups on the card detail page into one query | 3 round trips → 1 | Low | `app/(app)/b/[boardId]/c/[cardId]/page.tsx` |
| 4 | Replace `revalidatePath` with `revalidateTag` for fine-grained invalidation, so unrelated routes are not re-rendered | Reduces wasted RSC re-renders after every mutation | Medium | All server actions; new tag scheme |
| 5 | Cache `computeVelocity(6 sprints)` and burndown results in the workspace store, invalidate on sprint completion | Skip re-compute on every sprint-report view | Medium | `lib/queries/sprint-report.ts` + `stores/workspace-store.ts` |
| 6 | Prefetch common workspace routes via `<link rel="prefetch">` triggered on top-nav hover | Perceived navigation latency drops to near-zero | Low | `components/nav/top-nav.tsx` |
| 7 | Lazy-mount `TourOverlay` only when `onboardingCompletedAt === null` is true (already gated, but the module is still imported eagerly) | ~10–15 KB initial JS deferred | Low | `app/(app)/layout.tsx` |
| 8 | Add a network-level authentication gate in middleware (defense-in-depth against a missed `requireUser()`) | No perf cost; closes a silent-exposure risk | Low | `middleware.ts` |

---

## 5. Frontend — Components, Stores, and Hooks

This layer is where the user actually interacts with the application: dragging cards, opening the command palette, editing checklists, and watching live updates from other people on the same board.

### State stores

The application has exactly two Zustand stores. Both are instantiated through React context (not as global singletons), so each board view and each workspace view owns its own isolated instance.

**`stores/board-store.ts`** holds the dense per-board data: lists, cards, labels, card-label and card-member junctions, checklists and items, comments (capped at 200 per card), attachments, card links, components, card components, card versions, board profiles, and board memberships. It also holds ephemeral multi-select state (`selectedCardIds: Set<string>`) used by the bulk action bar. Every `add*` action contains an idempotency guard that returns the state unchanged if the row already exists by ID, so the same change cannot be applied twice when the CDC echo arrives. The `removeCard` action performs a cascade removal of all related rows in a single atomic `set`. The provider re-creates the store only when the `boardId` changes, never on every re-render.

**`stores/workspace-store.ts`** holds the cross-board data: boards, lists, cards (in a lighter shape than the board store), sprints, components, card components, versions, card versions, card links, card members, and workspace profiles. Its actions are named `upsertX` / `patchX` / `removeX`, and `upsertCard` is idempotent on `id` and merges rather than replacing.

### Real-time hooks

Live updates flow through Supabase Realtime change-data-capture (CDC). Each hook owns one channel and one set of subscriptions.

**`hooks/use-board-realtime.ts`** subscribes to fifteen tables on the channel `board:{boardId}`. Before subscribing, it calls `supa.realtime.setAuth(token)` so the realtime server evaluates RLS as the authenticated user. The hook contains fifteen hand-written `rowTo*` deserializer functions that convert snake_case Supabase payloads into camelCase TypeScript types, including `new Date()` coercion for timestamp fields. When a card's `board_id` no longer matches the current board (because it was moved to a different board), the hook removes the card from the store — this handles cross-board move eviction.

**`hooks/use-workspace-realtime.ts`** is the equivalent for the workspace store. Its channel is `ws:{workspaceId}`. Because `postgres_changes` only supports equality filters, this hook iterates the list of boards in the workspace and registers separate subscriptions on `lists`, `card_links`, and `card_members` for each board. The list of board IDs is hashed into a sorted comma-joined string so that the dependency array only changes when the IDs actually change, not on every render. The hook returns `{subscribed: boolean}` so callers can show an offline indicator.

Other real-time hooks include:

- `hooks/use-board-presence.ts` (Supabase Presence on the channel `board:{boardId}:presence`) tracks who is currently viewing the board and which card they have open.
- `hooks/use-people-cache.ts` is a localStorage-backed collaborator list with a 24-hour TTL, used in the "Create workspace" dialog to preload a collaborator dropdown.
- `hooks/use-activity-sync.ts`, `hooks/use-workload-sync.ts`, and the three membership-sync hooks each subscribe to a small set of tables and call `router.refresh()` (debounced) to re-run the relevant Server Component.
- `hooks/use-workspace-versions.ts` is self-contained: it holds its own state seeded from initial props, snapshots from the server after mount, and then subscribes to the `versions` table.

### Smaller UI helper hooks

These live in `lib/use-*.ts` rather than `hooks/`, because they are stateless or near-stateless.

- `lib/use-activity-panel.ts` synchronizes the activity-panel open/closed state across components and tabs through `useSyncExternalStore`, a custom `trinno:activity-toggle` event, and the native `storage` event.
- `lib/use-command-palette.ts` exposes a module-level singleton with imperative open/close functions, so any code in the codebase can open the command palette without going through React context.
- `lib/use-nav-chords.ts` implements Vim-style `g`+letter shortcuts to navigate between workspace views (`g r` for roadmap, `g b` for boards, and so on), plus `⌘K` / `Ctrl+K` for the command palette.
- `lib/use-pinch-zoom.ts`, `lib/use-media-query.ts`, and `lib/use-touch-device.ts` are SSR-safe wrappers around browser APIs used by data-visualization views.

### Pure-utility libraries

- `lib/board-filters.ts` defines the `Filters` type, the `LaneMode` union, and the functions that parse filters from URL search parameters, serialize them back, apply them to cards, and partition the result into swimlanes.
- `lib/board-templates.ts` defines four static board templates (`blank`, `standup`, `bug_triage`, `okr_sprint`).
- `lib/format.ts` and `lib/format-date.ts` provide the short identifiers (`TR-XXXXXX`, `BD-XXXXXX`) and the project-wide `dd/mm/yyyy` date format.
- `lib/palette-match.ts` implements the case-insensitive substring matching that powers the command palette.
- `lib/status.ts` defines the `StatusKind` union and the label maps used to render status badges.
- `lib/undo-bus.ts` is a module-level pub/sub bus that holds a single pending undo entry plus an 8-second auto-dismiss timer. `UndoBanner` subscribes to it directly.
- `lib/validation.ts` exports all Zod schemas used to validate server-action inputs.
- `lib/utils.ts` exposes only `cn(...inputs)` — a `clsx` + `tailwind-merge` combination.

### The most important components

**`components/board/board-view.tsx`** (about 590 lines) is the top-level client component for a board. It mounts the board and workspace realtime hooks and the presence hook, and it contains the entire drag-and-drop context for both lists and cards. The DnD architecture uses `@dnd-kit/core` with an 8-pixel activation distance to disambiguate clicking a card from dragging it, and a `DragOverlay` for the floating ghost. The optimistic drag flow follows the same five-step pattern that recurs throughout the codebase:

1. Compute the new position using `positionBetween` (a fractional index between the neighbors).
2. Apply the change locally to the Zustand store (instant re-render).
3. Fire the server action inside `useTransition`.
4. On failure, show a toast, push into `errorBus`, and call `router.refresh()` to restore server state.
5. On success for destructive operations, push an entry into `undoBus` with a revert callback.

**`components/board/card-modal.tsx`** (about 900 lines) is the full-detail card editor. It can render either as a dialog (when intercepted from the board) or as a full page (when navigated to directly). It reads state from `BoardStoreContext` and composes 20+ smaller sub-section components (labels, due dates, members, owner, checklists, attachments, subtasks, links, time tracking, components, versions, and so on). Description edits are debounced 800 ms; title edits save immediately on blur and push an undo entry.

**`components/board/card-tile.tsx`** (about 620 lines) is the sortable card tile rendered inside `ListColumn`. It is heavily optimized for boards with 200+ cards: it uses module-level frozen arrays as stable selector return values (to silence Zustand's `getSnapshot should be cached` warning), `useShallow` on array selectors, and a `quickViewOpen` boolean that gates expensive store scans. The `CardQuickView` component is lazy-mounted only when the user opens the quick view, saving roughly 27 KB of components from the initial render.

**`components/board/bulk-action-bar.tsx`** (about 830 lines) is the fixed bottom bar that appears when at least one card is selected. It is capped at 50 cards (`BULK_LIMIT = 50`). Every action — mark completed, archive, move to list, add label, assign/unassign member, set sprint, set priority, add component — follows the snapshot/apply-local/server-action/undo pattern.

### Component inventory

The `components/` directory contains roughly 100 components organized by feature:

- `components/board/` — about 38 files, split between top-level board UI and the `card/` sub-directory (label sections, checklist sections, comment sections, due-date pickers, type/priority/cover/parent pickers, story-points chips, time chips, watch toggles, the move-to-board dialog, and so on).
- `components/dashboard/` — 17 files: the gadget grid, sortable grid, gadget add/edit/share dialogs, and one component per gadget type.
- `components/roadmap/` — 13 files: the main view, bar, header, row handle, filter bar, list view, dependency arrows, critical-path overlay, milestone dialog and markers, mini map, priority gutter, sprint overlay, cascade confirm dialog.
- `components/sprint/` — 11 files: backlog client and list, burndown chart, sprint creation and completion dialogs, sprint card, date-conflict dialog, sprint picker, sprint report, velocity strip.
- `components/workspace/` — 11 files: all-tasks view and supporting components, board grid, create-board and create-workspace dialogs, favorite toggle, invite-member form, member list, workspace settings, store provider, switcher.
- `components/me/` — 8 files: active sprints, blocked cards, inbox, open cards, timeline, today strip, watchlist, week Gantt.
- `components/nav/` — 5 files: top nav, account menu, mobile drawer, notification bell.
- `components/epic/` — 4 files.
- `components/workload/` — 4 files.
- `components/inbox/` — 2 files.
- `components/ui/` — about 15 reusable primitives.

### UI primitives in `components/ui/`

All primitives are built on **Base UI** (`@base-ui/react`), not Radix. This gives focus-trap, escape-to-close, scroll-lock, and `aria-modal` semantics for free. The most distinctive primitives are:

- `button.tsx`: `ButtonPrimitive` with `class-variance-authority` variants (`default` shimmer pill, `outline` glass hairline, `secondary`, `ghost`, `destructive`, `link`) and size variants. 44-pixel touch floors apply on coarse-pointer devices.
- `dialog.tsx`: a thin wrapper over Base UI `Dialog.Root` with a neutral backdrop (`rgb(0 0 0 / 0.65)` plus `backdrop-blur-sm`).
- `bottom-sheet.tsx` (about 200 lines): a Base UI dialog rendered as a slide-up sheet from the bottom of the viewport, with drag-to-dismiss on the grab bar.
- `responsive-modal.tsx`: composes `Dialog` (≥768 px) and `BottomSheet` (<768 px) behind a single API.

### Key observations about the component layer

- **Two stores, two channels, two domains.** The board store and the `board:{id}` channel hold dense per-board data; the workspace store and the `ws:{id}` channel hold cross-board data. Views that need only one slice (such as workload or roadmap) mount only the workspace hook.
- **Optimistic-update discipline is consistent but not abstracted.** Every mutating component repeats the snapshot → apply local → `useTransition` → rollback → undo pattern. The `undoBus` is the only piece of this pattern that has been extracted into a shared utility.
- **Real-time strategy is CDC-only.** There is no WebSocket pub/sub layer, no Server-Sent Events, and no manual websocket reconnection logic. Writes always go through a Server Action; the CDC echo confirms the change.
- **Performance hot paths use specific micro-optimizations.** `CardTile` uses module-level frozen arrays as stable selector return values, `useShallow` for array selectors, and lazy mounts the quick view. These were driven by profiling boards with around 200 cards.
- **Module-level UI singletons.** The command palette and the activity panel both use module-level state plus `useSyncExternalStore`, so any imperative event handler (a keyboard shortcut, a notification bell click, a gadget toolbar button) can open or toggle them without going through React context.

### Improvement opportunities — ranked by expected speed / performance gain

| Rank | Fix | Expected gain | Effort | Location |
|---|---|---|---|---|
| 1 | Virtualize card lists with more than 50 items using `@tanstack/react-virtual` | Render cost scales with viewport, not card count. 5–10× faster paint on boards with 200+ cards | Medium | `components/board/list-column.tsx` |
| 2 | Lazy-load `card-modal.tsx` (~900 lines) and its sub-sections via `next/dynamic` | 40–60 KB initial JS deferred until first card open | Low | `components/board/card-tile.tsx`, `components/board/board-view.tsx` |
| 3 | Batch CDC store updates with `requestIdleCallback` or `unstable_batchedUpdates` to avoid render storms when many rows update simultaneously | Smoother UI under heavy realtime traffic (bulk archives, seed scripts) | Medium | `hooks/use-board-realtime.ts`, `hooks/use-workspace-realtime.ts` |
| 4 | Memoize `applyFilters` and `partitionLanes` results via `useMemo` keyed by `cards.length` + serialized filters | Skips O(n·m) recompute on every filter-bar keystroke | Low | `components/board/board-view.tsx` |
| 5 | Move card and list sorting from selector reads into store mutation paths (sort once on write, not on every read) | Removes repeated `Array.sort` from hot render paths | Medium | `stores/board-store.ts`, `stores/workspace-store.ts` |
| 6 | Lazy-load `markdown.tsx` with its remark/rehype dependencies via `next/dynamic` | ~30 KB deferred until first markdown render | Low | `components/markdown.tsx` |
| 7 | Debounce realtime fan-out re-subscription in `use-workspace-realtime` when the board list churns | Avoids subscription thrash when workspace members join/leave | Low | `hooks/use-workspace-realtime.ts` |
| 8 | Lazy-mount `CardQuickView` (already gated behind `quickViewOpen`, but verify all internal dialogs are also lazy) | Marginal additional savings on the lightest path | Low | `components/board/card-tile.tsx` |
| 9 | Replace per-component `cn()` calls in hot paths (CardTile, CardMetaRow) with precomputed class string constants | Avoids string concatenation on every render at scale | Low | `components/board/card-tile.tsx` |
| 10 | Migrate `errorBus` to `useSyncExternalStore` for cleaner subscription semantics | No perf delta; cleanup-only improvement | Low | `lib/errors/error-bus.ts` |

---

## 6. Backend — Server Actions

Server actions are the primary write path for the application. The `actions/` directory contains 33 files, each grouping the mutations for one entity (workspaces, boards, lists, cards, comments, sprints, versions, dashboards, and so on).

### The impl / wrapper pattern

Every server action file follows the same two-tier structure:

1. **Implementation functions** named `*Impl(token, input)`. These accept the raw JWT as their first argument and use `dbAsUser(token, fn)` to perform the database work. They are deliberately decoupled from the request lifecycle so that `actions/seed.ts` can call them in sequence to seed a demo workspace.
2. **Public wrapper functions** that call `requireUser()` and `getSessionToken()`, then forward to the corresponding `*Impl`. These wrappers are what Client Components actually call.

Because every file starts with `"use server"`, every exported function in `actions/*` is automatically a server action.

### Authorization model

Authorization is enforced almost entirely by Row-Level Security in Postgres. The flow is:

- The wrapper authenticates the user via `requireUser()` and extracts the JWT via `getSessionToken()`.
- The implementation calls `dbAsUser(token, fn)`, which opens a transaction and sets `request.jwt.claims` to the decoded JWT. Inside the transaction, Postgres evaluates `auth.uid()` as the calling user.
- Every mutation uses the pattern `update().where(id).returning()` (or its insert/delete equivalent). If RLS blocks the write, zero rows come back and the implementation throws `new Error("Forbidden")`.

The single application-level role check in the entire actions layer is `assertCanManageSprints(tx, workspaceId, actorId)` in `actions/sprints.ts`, which reads `workspace_members.role` and throws unless the actor is `"owner"` or `"admin"`. This is defence-in-depth for sprint lifecycle operations.

### Workspace, board, and dashboard actions

- **`workspaces.ts`** — create, rename, delete, and toggle the `autoAssignCreator` flag. The owner row must be inserted before any other member row because the `is_workspace_admin` RLS helper only becomes true after the owner row exists.
- **`workspace-members.ts`** — invite (by email, via the `SECURITY DEFINER` Postgres function `find_user_id_by_email`), change role, remove. Re-invites use `onConflictDoNothing` followed by a re-select to distinguish "forbidden" from "already a member".
- **`boards.ts`** — create, rename, archive, delete, and `createBoardFromTemplate`. The template creation fans out to multiple `*Impl` functions for lists, status mappings, and labels.
- **`board-members.ts`** — same pattern as workspace members, but the role enum also includes `"observer"` (read-only).
- **`dashboards.ts`** — create, update, delete personal or workspace-scoped dashboards.
- **`dashboard-members.ts`** — share a dashboard, change role, remove. Includes an explicit self-invite guard.
- **`favorites.ts`** — toggle favorite board and record a board view. The `recordBoardView` action is called fire-and-forget on board page load.

### Card and sub-entity actions

- **`cards.ts`** is the largest single action file. It exports `createCard`, `updateCard`, `moveCard`, `moveCardToStatus`, `archiveCard`, `cascadeShiftBlockedAfter`, several bulk variants (`bulkArchiveCards`, `bulkSetSprint`, `bulkSetPriority`, `bulkSetCompleted`, `bulkAddLabel`), `moveCardCrossBoard`, and `reorderRoadmapRow`. Bulk actions are capped at 50 IDs by Zod schemas. The `reorderRoadmapRow` implementation uses `pg_advisory_xact_lock(hashtext('reorder:' + boardId))` to serialize concurrent reorders. `moveCardToStatus` deliberately omits `revalidatePath` because the epic-Kanban view relies on CDC.
- **`card-members.ts`**, **`card-components.ts`**, **`card-links.ts`**, **`card-versions.ts`** — small toggle-style actions. All four pass a zero-UUID placeholder for the `boardId` (or `workspaceId`) column, which is then overwritten by a database trigger. `card-links.ts` includes an application-level guard against self-linking.
- **`lists.ts`** — create, rename, move, delete, archive, set WIP limit, set status kind, ensure status list, set color. The `ensureStatusListImpl` uses `onConflictDoNothing` against a partial unique index `(board_id, status_kind) WHERE status_kind IS NOT NULL`, with a re-select to recover from a lost race.
- **`checklists.ts`** — create, rename, delete checklists; add, toggle, remove items. Fractional positioning via `positionBetween`.
- **`attachments.ts`** — register, delete, and create signed URLs. This is the rare action file that uses both Drizzle (for the database rows) and the service-role Supabase client (for Storage operations on the `card-attachments` bucket).
- **`labels.ts`** — create, rename, delete labels and toggle card labels.
- **`worklogs.ts`** — log work and delete worklogs.
- **`watchers.ts`** — watch and unwatch cards. `auto: false` indicates a manual watch (distinct from auto-watches added by triggers).
- **`sla.ts`** — create, update, delete SLA policies; scan a board's SLA. The scan calls the `SECURITY DEFINER` function `public.scan_board_sla(boardId)`, which bypasses the no-user-write RLS policy on `card_sla`.

### Collaboration and notifications

- **`comments.ts`** — create, edit, delete, resolve. Uses raw SQL via `tx.execute(sql\`...\`)` rather than Drizzle's builder because of a known issue with Drizzle's type inference on nullable UUID columns; the explicit `RETURNING` clause casts `parent_comment_id` through `nullif(to_jsonb(comments)->>'parent_comment_id', '')::uuid`.
- **`notifications.ts`** — mark one notification as read, or mark all unread notifications as read in bulk.
- **`user-notification-prefs.ts`** — list, set, and delete per-kind/per-channel notification preferences; get and set the email digest preference.
- **`milestones.ts`** — create, update, delete, list. A workspace-level milestone (with `boardId IS NULL`) shows up alongside board-scoped milestones in the list query.
- **`sprints.ts`** — create, update, delete, start, complete, bulk-shift dates, assign cards. This is the only file with an explicit application-level role check (`assertCanManageSprints`). Starting a sprint relies on a Postgres partial unique index to reject a second concurrent active sprint.
- **`versions.ts`** — create, update, delete release versions. Auto-fills `releaseDate` when transitioning to `"released"` and the date was not already set.
- **`components.ts`** — create, update, delete board-scoped components (team components, not React components).
- **`gadgets.ts`** — create, update, remove, move, and reorder dashboard gadgets. `moveGadgetImpl` performs a three-step swap to avoid index collision; `reorderGadgetsImpl` uses a two-phase update (negative temporary positions, then final positions).

### Authentication, onboarding, and search

- **`auth.ts`** — only one export: `logout()`, which calls `supa.auth.signOut()` and redirects to `/login`.
- **`onboarding.ts`** — `markOnboardingCompleted()` updates `profiles.onboardingCompletedAt`.
- **`profile-lookup.ts`** — `lookupProfileByEmail(email)` returns one of `{kind: "found"}`, `{kind: "exists"}`, or `{kind: "missing"}`, distinguishing "the user exists and you can see their profile" from "the user exists but RLS hides them from you".
- **`profile-search.ts`** — three search functions: `searchMentionables` (board-scoped, up to 8), `listCollaborators` (cached collaborators), and `searchProfiles` (cross-workspace search up to 12, collaborator-ranked). The cross-workspace search uses the service-role Supabase client to scan `auth.users` by email, guarded by a null check on `SUPABASE_SERVICE_ROLE_KEY`.
- **`seed.ts`** — orchestrates a demo workspace seeding by calling other `*Impl` functions in sequence. Non-fatal errors are swallowed by a `safe()` helper, which means partial failures leave a partially-seeded workspace without surfacing the failure to the user.
- **`search.ts`** — full-text card search and a card-link picker variant. Both delegate to `lib/queries/search.ts`.

### Cache invalidation

The actions layer uses `revalidatePath` as its sole cache invalidation mechanism. There is no `revalidateTag`, no `unstable_cache`, and no tag-based fetch caching. Board mutations invalidate `/b/${boardId}`, workspace mutations invalidate `/w/${workspaceId}/...`, dashboard mutations invalidate `/dashboards/...`, and so on. Several mutations deliberately omit `revalidatePath` when the change is expected to propagate through CDC (the most prominent example is `moveCardToStatus`).

### Key observations about the actions layer

- **The impl/wrapper split is universal.** It cleanly separates authentication ("is the user signed in?") from authorization ("can this user perform this action on this resource?"). The wrapper handles the former; RLS handles the latter.
- **RLS is the primary authorization layer.** The pattern of returning zero rows from an RLS-blocked write — and the implementation responding with `throw new Error("Forbidden")` — recurs throughout the code. This produces a uniform but coarse error surface: clients cannot distinguish "access denied" from "not found".
- **Mixed database access.** Drizzle is used for the vast majority of queries, but raw SQL is used in four specific situations: calling `SECURITY DEFINER` Postgres functions (`find_user_id_by_email`, `scan_board_sla`), advisory locking, working around Drizzle's nullable-UUID column inference in `comments.ts`, and targeting partial indexes in `onConflictDoNothing`.
- **Some side effects are deliberately omitted.** Several mutating actions skip `revalidatePath` because optimistic UI or CDC handles the update. Examples include `deleteComment`, `deleteWorklog`, `toggleCardMember`, and `watchCard`. The trade-off is that direct navigation to a stale Server Component cache may temporarily show the pre-mutation state until the next revalidation.

### Improvement opportunities — ranked by expected speed / performance gain

| Rank | Fix | Expected gain | Effort | Location |
|---|---|---|---|---|
| 1 | Rewrite `bulkShiftCardDatesImpl` from a row-by-row loop into a single `UPDATE ... SET ... FROM (VALUES ...)` statement | 10–50× faster on 50-card shifts | Medium | `actions/sprints.ts:175` |
| 2 | Convert bulk card actions (`bulkArchiveCards`, `bulkSetSprint`, `bulkSetPriority`, `bulkSetCompleted`, `bulkAddLabel`) from N individual statements into single batch UPDATEs with `WHERE id = ANY($1)` | 5–10× faster at the 50-card cap; fewer round trips | Medium | `actions/cards.ts:521-593` |
| 3 | Wrap `createBoardFromTemplateImpl` fan-out in a single `dbAsUser` transaction so partial failures roll back instead of leaving half-built boards | Correctness fix + one round trip instead of many | Medium | `actions/boards.ts:123` |
| 4 | Add advisory locks (matching the `reorderRoadmapRow` pattern) to other concurrent reorder/move actions on lists, gadgets, and checklist items | Eliminates reorder-race data corruption under concurrent edits | Medium | `actions/lists.ts`, `actions/gadgets.ts`, `actions/checklists.ts` |
| 5 | Replace the raw-SQL workaround in `comments.ts` with a Drizzle `.$type<...>()` annotation or upgrade Drizzle past the nullable-UUID bug | No perf delta but restores type safety and removes brittle SQL | Low | `actions/comments.ts:60-88` |
| 6 | Convert `seed.ts` `safe()` helper to return `{ok, failed[]}` and surface partial failures to the user | Correctness fix — users currently get a "success" toast on partial seeds | Medium | `actions/seed.ts` |
| 7 | Add structured error types (`{code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"}`) and replace `throw new Error("Forbidden")` everywhere | Lets the UI distinguish access-denied from not-found and show appropriate messaging | Medium | New `lib/errors/codes.ts` + every `*Impl` |
| 8 | Replace per-action `revalidatePath` calls with a small `revalidate()` helper that batches multiple paths into one call | Avoids duplicate revalidation in actions that hit several paths (e.g. `card-versions`, `versions`) | Low | New `lib/revalidate.ts` |
| 9 | Add a `.max(50)` Zod cap uniformly to every bulk-input schema (currently inline on cards only) | Consistency + DoS protection | Low | `lib/validation.ts` |
| 10 | Replace the `find_user_id_by_email` RPC with a Drizzle query against a view that exposes `auth.users.email`, removing one SECURITY DEFINER function | One fewer round trip per invite | Medium | New view in `supabase/migrations/` + invite actions |

---

## 7. Backend — API Route Handlers and Library Services

### API route handlers

| Route | Method | Description |
|---|---|---|
| `/api/card-history` | GET | Lazy-loads `card_field_history` and `card_sprint_history` rows for the card-history accordion. This is kept out of the initial card-modal payload because cards may have hundreds of history rows. Auth via `requireUser` + RLS. |
| `/api/cron/send-emails` | GET | Per-event email dispatcher. Polls the `notifications` table for rows where `email_sent_at IS NULL`, respects `user_notification_prefs`, resolves the actor's name and the card and board titles, and sends a single-notification HTML email via Resend. On success, stamps `email_sent_at`. Auth via `Authorization: Bearer ${CRON_SECRET}` header, intended for the Vercel cron schedule. Runs on the Node.js runtime with `force-dynamic`. |
| `/api/notifications/digest` | POST | Daily digest. Iterates every `profiles` row with `email_digest_optin = true`, builds a grouped digest (grouped by kind, then by card), sends one digest email per user via Resend, then marks all included notification IDs as `email_sent_at` in chunks of 200. Auth via `x-cron-key` header. Skips silently when `RESEND_API_KEY` is unset (development convenience). |
| `/api/notifications/recent` | GET | Returns the most recent 8 notifications and the total unread count for the top-nav bell. |
| `/api/sla/scan` | POST | Triggers the `scan_board_sla(p_board_id)` Postgres function for a board, then calls `revalidatePath` on the board page and its settings page. Returns the count of currently-breached active cards. Auth via `Authorization: Bearer ${CRON_SECRET}`. Body is Zod-validated `{boardId: uuid}`. Constructs the service-role Supabase client inline rather than going through a shared wrapper. |
| `/api/upload` | POST | Issues a Supabase Storage signed upload URL for the `card-attachments` bucket. Performs an explicit Drizzle board-membership check (so a non-member receives a 403) before delegating to the service-role client. Body is Zod-validated `{cardId: uuid, filename: string}`. |
| `/api/watchers/check` | GET | Returns `{watching: boolean, watchers: [...]}` for a card, used by the card modal on open. |
| `/api/worklogs` | GET | Returns the time-tracking entries for a card. |

### Database layer

**`lib/db/client.ts`** holds a single `postgres-js` connection pool. The pool size is controlled by the `DATABASE_POOL_MAX` environment variable (default 2) and uses `idle_timeout: 10`, `connect_timeout: 5`, and `prepare: false`. The pool is wrapped by `drizzle-orm/postgres-js`.

The key export is `dbAsUser(jwt, fn)`. It wraps every caller-facing query in a database transaction. Before handing control to `fn`, it issues:

```sql
SELECT set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', <claims_json>, true);
```

This activates Postgres Row-Level Security for the entire transaction, with the caller's JWT as context. The claims JSON is memoized per request using React's `cache()` to avoid redundant JWT decoding. The raw `db` object is intentionally not exported — every call must go through `dbAsUser`.

**`lib/db/schema.ts`** contains the Drizzle `pgTable` definitions. The enums declared here are `workspaceRole`, `boardRole`, `boardVisibility`, `listStatusKind`, `cardPriority`, `linkKind`, `sprintState`, `versionState`, and `dashboardScope`. The core tables — corresponding one-to-one with the SQL migrations — include `profiles`, `workspaces`, `workspace_members`, `boards`, `board_members`, `lists`, `cards` (the central entity, with around 20 columns), `card_labels`, `card_members`, `checklists`, `checklist_items`, `comments`, `attachments`, `activity`, `card_links`, `sprints`, `card_sprint_history`, `card_field_history`, `notifications`, `card_watchers`, `user_notification_prefs`, `worklogs`, `sla_policies`, `card_sla`, `rules`, `rule_runs`, `components`, `card_components`, `versions`, `card_versions`, `board_favorites`, `recent_views`, `dashboards`, `dashboard_members`, `gadgets`, and `milestones`.

### Authentication and Supabase client wrappers

`lib/auth.ts` exposes four helpers, all wrapped in React `cache()` so they deduplicate within a single Server Component request:

- `getUser()` returns the current user or `null`.
- `getSessionToken()` returns the JWT access token or `null`.
- `requireUser()` redirects to `/login` if no user is present, otherwise returns the user.
- `requireSession()` returns the full session or redirects.

There are three Supabase client wrappers in `lib/supabase/`:

- `server.ts` exposes `createSupabaseServer()` — an async function that uses `@supabase/ssr`'s `createServerClient` with the Next.js `cookies()` store. This is used in Server Components and API routes for authentication only; all data queries go through Drizzle.
- `browser.ts` exposes `createSupabaseBrowser()` — a synchronous wrapper for use in Client Components. This is used for Realtime subscriptions and client-side authentication.
- `middleware.ts` exposes `updateSession(req)`, which is called from the root `middleware.ts`.

Notably, there is **no shared service-role wrapper**. The service-role Supabase client is constructed inline in four places (`lib/notify-email.ts`, `lib/notifications/email-digest.ts`, `app/api/sla/scan/route.ts`, and `app/api/upload/route.ts`), each time as `createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`.

### Domain service modules

The domain modules are intentionally pure — they perform no I/O, make no Supabase calls, and do not import React. Data fetching is the sole responsibility of `lib/queries/*`, which means these domain modules are trivially unit-testable.

- **`lib/aggregate-kanban/group.ts`** — `AGGREGATE_COLUMNS` (todo, in_progress, review, done, blocked, unmapped), `groupByStatus(cards, lists)`, `findTargetListId`, and `cardMatchesFilter`. Powers the cross-board "All Tasks" view.
- **`lib/dashboards/resolvers.ts`** — one resolver per gadget type. Each resolver takes `(token, ...config)`, delegates to `dbAsUser`, and returns the data the gadget needs to render.
- **`lib/epic/group-children-by-status.ts`** — single export that groups an epic's child cards into status buckets, sorted by fractional `position`.
- **`lib/roadmap/`** — four files:
  - `critical-path.ts` runs a Kahn topological sort over the `is_blocked_by` dependency DAG and returns the set of cards on the critical path.
  - `dates.ts` handles all UTC date math for the Gantt grid, with zoom levels `fit`, `week`, `month`, `quarter`.
  - `layout.ts` groups roadmap cards into lanes by epic, assignee, or component, and performs greedy overlap stacking within each lane.
  - `sparse-rank.ts` provides integer-midpoint rank insertion with collision throwing.
- **`lib/workload/`** — two files:
  - `buckets.ts` performs ISO-week bucketing for the workload histogram, spreading `estimateMin` proportionally across overlapping weeks.
  - `drag.ts` does the pure math for drag-to-reschedule (move, resize-left, resize-right), clamped to ±365 days.

### Notifications and email

The project runs two completely independent email dispatch paths, by design. They share no runtime imports.

**Path 1 — per-event delivery** (`lib/notify-email.ts` plus `/api/cron/send-emails`):

- Polls the `notifications` table for rows where `email_sent_at IS NULL` and `created_at < cutoff`.
- Checks `user_notification_prefs(kind, channel='email', enabled=true)` for each notification.
- Resolves the recipient's email via `auth.admin.getUserById`, the actor's name from `profiles`, and the card and board titles.
- Sends a single-notification HTML email via the Resend HTTP API.
- Stamps `email_sent_at` on success (or on opt-out skip).
- The `VERB_BY_KIND` map currently covers 13 notification kinds.

**Path 2 — daily digest** (`lib/notifications/email-digest.ts` plus `/api/notifications/digest`):

- Iterates every `profiles` row with `email_digest_optin = true`.
- `buildDigestForUser(userId, {sb})` pulls the last 24 hours of `email_sent_at IS NULL` notifications, groups them by kind and then by card, bulk-resolves the card and board titles, and renders a grouped HTML table plus a text fallback.
- The route sends the digest via Resend, then marks all included notification IDs as `email_sent_at` in chunks of 200.

Both paths share these environment variables: `RESEND_API_KEY`, `RESEND_FROM` (default `"Trinno <notifications@trinno.local>"`), and `NEXT_PUBLIC_APP_URL`. The separation keeps each path independently deployable, at the cost of label drift if a new notification kind is added without updating both files.

### Errors and ordering

There is no HTTP error class hierarchy. The only file in `lib/errors/` is `error-bus.ts`, a client-side `"use client"` singleton event bus for persistent UI error display (with `push`, `dismiss`, `clear`, `subscribe`, and `snapshot`).

`lib/ordering.ts` is a thin wrapper over the `fractional-indexing` package, exposing `positionBetween(prev, next)` and `positionsBetween(prev, next, count)`. It is used everywhere ordered rows live (lists, cards, checklists, checklist items).

### Key observations about the API and library layer

- **RLS is the authorization boundary, not application code.** The one exception is `/api/upload`, which performs an explicit Drizzle board-membership check before issuing the service-role storage URL.
- **Two Supabase client tiers with no shared service-role wrapper.** User-scoped work goes through `@supabase/ssr` clients (auth only); data queries go through Drizzle `dbAsUser`. Service-role clients are constructed inline four times.
- **Email is intentionally decoupled.** The per-event and digest paths share no imports. `VERB_BY_KIND` and `KIND_LABEL` are deliberately duplicated.
- **Domain modules are pure computation.** No I/O, no Supabase, no React. Data fetching lives in `lib/queries/`. Tests can use plain objects.
- **The rules engine is types-only.** `lib/rules/types.ts` defines the full `RuleEvent | RuleTrigger | RuleConditions | RuleAction` type surface, and the `rules` and `rule_runs` schema tables are fully defined. But no runtime evaluator exists yet — the engine is schema-ready but not yet wired into the execution path.

### Improvement opportunities — ranked by expected speed / performance gain

| Rank | Fix | Expected gain | Effort | Location |
|---|---|---|---|---|
| 1 | Raise `DATABASE_POOL_MAX` from the default of 2 to 10–20 in production | Eliminates connection queueing under concurrent requests. 5–20× throughput improvement at load | Low | `.env.cloud` + verify `lib/db/client.ts:1-20` |
| 2 | Batch dashboard gadget resolvers so all gadgets on a dashboard run in one multi-CTE query, not N independent queries | One round trip vs N. 100–300 ms dashboard load improvement | High | `lib/dashboards/resolvers.ts` + `lib/queries/dashboards.ts` |
| 3 | Memoize roadmap `criticalPath` result in the workspace store, keyed by card+link version, invalidate on CDC | Avoids Kahn topological sort on every roadmap re-render | Medium | `components/roadmap/roadmap-view.tsx` + `stores/workspace-store.ts` |
| 4 | Replace per-recipient `auth.admin.getUserById` calls in the email worker with a single paged `auth.admin.listUsers` | 50 RPC calls → 1 per cron run | Medium | `lib/notify-email.ts` |
| 5 | Group email-cron notifications by recipient and send one Resend email per user per run instead of one email per notification | 5–10× fewer Resend API calls; far fewer rate-limit hits | Medium | `lib/notify-email.ts` |
| 6 | Move `/api/upload`'s board-member check and storage signed-URL generation into a single `SECURITY DEFINER` Postgres function | 2 round trips → 1 | Medium | New migration + `app/api/upload/route.ts` |
| 7 | Promote `/api/card-history` data into the card-modal's initial server-action payload when the history row count is under 50 | Eliminates the lazy-fetch flash for most cards | Medium | `actions/cards.ts` + card modal |
| 8 | Extract the inline service-role client construction into a shared `lib/supabase/service-role.ts` singleton with module-level caching | Saves auth-setup overhead per call; single point of control for credential rotation | Low | New file + 4 call-site refactors |
| 9 | Gate `/api/notifications/digest` `x-cron-key` so missing-env behavior throws instead of skipping auth (currently a development convenience that should not reach production) | Closes a production-only auth bypass risk | Low | `app/api/notifications/digest/route.ts` |
| 10 | Verify React `cache()` deduplication covers every server-side `requireUser()` and `getSessionToken()` call path, and warm the JWT claims cache at the top of every layout | Saves repeated JWT decoding within a single request | Low | `lib/auth.ts`, layout files |

---

## 8. Data Layer and Infrastructure

### Supabase local stack — `supabase/config.toml`

The configuration file `supabase/config.toml` defines the local Docker stack with `project_id = "trello-foundation"`.

| Service | Port | Notes |
|---|---|---|
| PostgREST API | 54321 | Exposed schemas: `public`, `graphql_public` |
| Postgres database | 54322 | Major version 17 |
| Studio | 54323 | API URL `http://192.168.68.58` (LAN IP) |
| Mailpit (email interception) | 54324 | Catches outbound email in development |
| Analytics | 54327 | Postgres backend |
| Edge Runtime | 8083 (inspector) | Deno v2, `per_worker` hot-reload policy |
| Connection Pooler | 54329 (disabled) | Transaction mode, pool size 20 |

Important authentication settings:

- `jwt_expiry = 604800` (7 days) — extended from the default 1 hour.
- `enable_refresh_token_rotation = true`; `refresh_token_reuse_interval = 10`.
- `timebox = "720h"` (30 days); `inactivity_timeout = "168h"` (7 days).
- Rate limits significantly raised (`sign_in_sign_ups = 2000`, `token_refresh = 2000`, `token_verifications = 2000`) because the integration test suite spins up around 200 ephemeral users per run.
- Email confirmations are disabled locally. MFA, SMS, OAuth, and anonymous sign-ins are all disabled.

Storage: `file_size_limit = "50MiB"`, with the S3 protocol enabled locally. The bucket `card-attachments` is created at runtime by the application; it is not declared in `config.toml`.

The Supabase CLI is linked to the cloud project: project reference `xndddfopnlrzkydtnjxo`, organization `oedfsryymnyicaltvbba`. The currently tracked branch is `main`.

Two migration files carry a `.disabled` suffix and are intentionally skipped:

- `0056_auth_domain_allowlist.sql.disabled` — an email-domain allowlist hook for production lockdown.
- `0057_storage_rls.sql.disabled` — storage bucket Row-Level Security policies. This cannot be applied through `supabase db push` because the `storage.objects` table is owned by `supabase_storage_admin`; it must be applied manually through the Studio SQL Editor.

### Database migrations — 96 in total

There are 96 migrations numbered 0001 through 0096, with 0058 absent. Grouped by domain:

- **Foundation and authentication (0001–0005)** — base schema, the `handle_new_user()` profile-creation trigger on `auth.users`, the initial RLS stubs, the workspaces insert policies, and the `find_user_id_by_email` `SECURITY DEFINER` helper.
- **Lists and cards core (0006–0009)** — `lists` and `cards` tables with fractional `position` columns, their RLS policies, addition of these tables to the `supabase_realtime` publication, and the addition of `due_date`, `due_complete`, and `cover_color` columns.
- **Junctions and content (0010–0014)** — labels and `card_labels`, `card_members`, `checklists` plus `checklist_items`, `comments`, and `attachments`.
- **Activity and search (0015–0017)** — `activity` table, `log_activity()` `SECURITY DEFINER` trigger fan-out, and a generated `tsv tsvector` column on cards with a GIN index for full-text search.
- **Card types and links (0018–0019)** — `card_type` enum (`task`, `story`, `epic`, `bug`, `subtask`) and `parent_card_id` FK; `link_kind` enum and `card_links` table.
- **Sprints and story points (0020–0022)** — `sprints` table with `sprint_state` enum, `story_points` column with composite index, and `wip_limit` on lists.
- **Notifications and watchers (0023–0026)** — `notifications`, `card_watchers`, the `emit_notification()` trigger fan-out, and `user_notification_prefs`.
- **Time tracking and SLA (0027–0029)** — `estimate_min` and `spent_min` columns, `worklogs` table, and `sla_policies` plus `card_sla`.
- **Automation, components, versions (0030–0032)** — the `rules` engine schema, board-scoped `components` plus `card_components`, and workspace-scoped `versions` plus `card_versions`.
- **Roadmap and timeline (0033, 0036–0038, 0046–0047)** — `start_date` and `target_date` columns, activity-trigger extensions for date changes, watcher-notification extensions for date changes, `status_kind` enum on lists, `roadmap_order` for manual row ordering, and activity logging for `roadmap_order` changes.
- **Dashboards and gadgets (0034–0035, 0068, 0093)** — `dashboards` and `gadgets` tables; later, `dashboard_members` for sharing; and a fix for an RLS infinite-recursion bug introduced by the sharing migration.
- **User preferences and profile (0039, 0041–0043, 0066, 0090, 0096)** — onboarding flag, card cover, board favorites, recent views, profile `handle` (changing mention resolution from display name to handle), email digest preferences, and a profile-search visibility opt-out.
- **Access control and RLS hardening (0048–0050, 0063, 0067, 0074)** — workspace-write extensions to visible boards, a centralized board-writer helper function, the auto-assign-creator workspace flag, a trigger that auto-inserts a board-member as a workspace-member, observer read-only enforcement, and two fixes to workload-view RLS gaps.
- **Epic constraints (0051–0055)** — single-level epic enforcement, a backfill that co-locates existing children, a pre-deploy cleanup that nullifies nested epic parents, a partial unique index that enforces at most one list per `(board_id, status_kind)`, and a CHECK constraint that `card_components.component_id` belongs to the same board as the card.
- **Notification refinements (0065, 0069–0073, 0079–0080, 0087)** — deduplication of watcher-plus-mention notifications, opt-in checks in `emit_notification`, new notification kinds, bulk-action notification rate limiting, the `email_sent_at` column for the email worker, owner-change notifications, missing-relation guards, an updated kind check constraint, and a completion notification.
- **Card history and audit (0086, 0089, 0091–0092)** — card-completion activity, `card_sprint_history`, `card_field_history` (a generic scalar audit log), and the addition of both history tables to the realtime publication.
- **Policy bug fixes (0078, 0081–0085)** — guards against missing card rows in `log_activity`, owner-change and sprint-change business-rule triggers, two ambiguity fixes for those triggers, and a restriction of the epic date-rollup trigger to INSERT-only.
- **Additional features (0040, 0044–0045, 0059–0062, 0064, 0075–0077, 0088, 0094–0095)** — card priority enum, denormalized `board_id` consistency triggers for cross-board moves, list color, single explicit card owner, epic date rollup, the unified `completed_at` semantics on cards, comment threading and resolution, addition of `workspace_members` to the realtime publication, REPLICA IDENTITY FULL for realtime delete events, automatic subtask-parent completion, a service-role bypass on `scan_board_sla`, and a `milestones` table.

### Drizzle configuration

`drizzle.config.ts` sets `schema = "./lib/db/schema.ts"`, `out = "./supabase/migrations"`, and `dialect = "postgresql"`. It loads `DATABASE_URL` from `.env.local` through `dotenv`.

A subtle but important point: the `out` directory points at `supabase/migrations/`, but `drizzle-kit generate` is **not used**. All migrations are hand-authored SQL files. Drizzle's role is purely schema-as-TypeScript-types, used for type-safe query construction. The authoritative deployment command is `supabase db push`, not `drizzle-kit push`.

In runtime, Drizzle is used for all server-action reads and writes; Supabase JS is used exclusively for authentication and realtime. The two coexist on different ports: Drizzle connects via the raw `DATABASE_URL` (port 54322 locally), and Supabase JS connects via PostgREST (port 54321).

### Middleware

The root `middleware.ts` file is only eight lines. It delegates to `updateSession` from `lib/supabase/middleware.ts`, with a matcher that excludes static assets and image-optimization paths. `updateSession` copies incoming headers (and injects `x-pathname`), calls `supa.auth.getUser()` to silently refresh the JWT and re-set the session cookie if it is near expiry, and returns the response.

There is no hard authentication redirect in middleware. Route-level authentication is enforced by `requireUser()` in Server Components.

### Build and style toolchain

`next.config.ts` is minimal — only `outputFileTracingRoot: path.join(__dirname)`. No custom Webpack configuration, no image domains, no environment remapping.

`vercel.json` declares a single cron:

```json
{
  "crons": [
    { "path": "/api/cron/send-emails", "schedule": "0 8 * * *" }
  ]
}
```

This fires the email-dispatch worker once a day at 08:00 UTC. Note that `DEPLOYMENT.md` describes the schedule as "every 5 minutes" — the documentation is inconsistent with `vercel.json`, which is the source of truth. The cron route itself reads `CRON_SECRET` from the `Authorization: Bearer ...` header.

`eslint.config.mjs` uses the flat config format and extends `next/core-web-vitals` plus `next/typescript` via `FlatCompat`. `postcss.config.mjs` has a single plugin: `@tailwindcss/postcss`. Tailwind v4 does not use a `tailwind.config.js`; the design tokens are CSS variables defined in `app/globals.css`.

`tsconfig.json` targets ES2017, uses `module: esnext` and `moduleResolution: bundler`, enables `strict`, sets `noEmit: true`, and aliases `@/*` to the project root. The two `litmus.*.ts` files are excluded from compilation because they import types that are not declared in `node_modules`.

`components.json` configures shadcn with the `base-nova` style (the newer Base UI-backed style, rather than the Radix-based `default`), `rsc: true`, and `iconLibrary: "lucide"`. CSS variables use `baseColor: "neutral"`.

### Environment variables

`.env.local.example` declares four keys:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-me
SUPABASE_SERVICE_ROLE_KEY=replace-me
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`.env.cloud` contains the four application secrets above plus Vercel-injected runtime variables (`VERCEL_ENV`, `VERCEL_GIT_*`, `VERCEL_OIDC_TOKEN`, `VERCEL_TARGET_ENV`, `VERCEL_URL`) and `TURBO_*` / `NX_DAEMON` keys that suggest a Turborepo or NX caching layer is configured in the Vercel project environment.

### `package.json` scripts

| Script | Command |
|---|---|
| `dev` | `next dev --turbopack` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `eslint` |
| `type-check` | `tsc --noEmit` |
| `test:unit` | `vitest run` |
| `test:e2e` | `playwright test` |
| `db:reset` | `supabase db reset` |
| `ci:lint` | `npm run lint && npm run type-check` |
| `ci:unit` | `vitest run --reporter=default` |
| `ci:e2e` | `playwright test --reporter=line` |

### Seed and utility scripts

The `scripts/` directory contains four ESM scripts:

- `screens.mjs` — a Playwright-based screenshot tool that signs up a demo user, navigates key routes, captures screenshots to `/tmp/screens`, and uses the Mailpit API to extract the email confirmation link automatically.
- `seed-aiwepi.mjs` — seeds a full "AIWEPI / Switch" project workspace from the project plan PDF data (5 epics, 11 stories, 11 subtask deliverables, 5 milestone-versions). Uses the service-role Supabase client.
- `seed-aiwepi-milestones.mjs` — an idempotent milestone seeder for an existing AIWEPI/Switch workspace.
- `seed-aiwepi-team.mjs` — seeds the AIWEPI workspace for an existing user identified by the `SEED_EMAIL` environment variable.

These scripts run manually against the cloud database; they are not part of the CI pipeline.

### Testing

The `tests/` directory is split into three subdirectories:

- `tests/e2e/` — 16 Playwright specs covering authentication, workspace and board management, drag-and-drop, card features, realtime, search and activity, epic Kanban, aggregate Kanban, completion flows, Gantt drag, Jira-style hierarchy and planning, Gantt integration with sprints, collaboration reports, and workload drag.
- `tests/integration/` — around 50 Vitest files that hit a live local Supabase instance. The pattern is to create a throwaway user with the service-role client, call `dbAsUser` or a server-action `*Impl` function directly, and assert against the database state.
- `tests/unit/` — around 18 Vitest files of pure logic: fractional ordering, roadmap layout, critical-path computation, sprint report aggregates, workload bucket grouping, gadget data resolvers, board filter logic, parent-cycle detection, and media query hooks.

The Playwright configuration runs a single worker (`fullyParallel: false`), uses Chromium only, sets `timeout: 60s` and `expect.timeout: 15s` (raised for cold CI runners), and uploads `playwright-report/` and `test-results/` artifacts on failure.

The Vitest configuration uses `environment: "node"`, `testTimeout: 15000`, `include: ["tests/**/*.test.ts"]`, and `tsconfigPaths: true`.

### Continuous integration

`.github/workflows/ci.yml` defines a single workflow with three parallel jobs, triggered on pull requests to `main` and pushes to `main`. All jobs use Node 22 with npm caching.

- **`lint`** — `actions/checkout@v4`, `actions/setup-node@v4`, `npm ci`, `npm run ci:lint`.
- **`integration`** — checkout, setup Node, `supabase/setup-cli@v1`, `npm ci`, `supabase start`, an environment-capture step that translates `supabase status -o env` output into the four application environment variables and writes `.env.local`, `npm run ci:unit`, then `supabase stop --no-backup` (always run, even on failure).
- **`e2e`** — same setup, plus a Playwright browser cache step and `npx playwright install --with-deps chromium`, then the same environment capture, then `npm run ci:e2e`, then artifact upload of `playwright-report/` and `test-results/` with `retention-days: 14`, then `supabase stop --no-backup`.

The three jobs run in parallel; there is no sequential dependency between them.

### Litmus orchestrator

The files `litmus.config.ts` and `litmus.playbook.ts` define a local CI orchestration layer (using the `litmus` framework). Its suites are `lint`, `type-check`, `test:unit`, and `test:e2e`. Selective suite execution is triggered by file pattern (changes in `supabase/migrations/**` run only `test:unit`; changes in `tests/e2e/**` run only `test:e2e`). The definition-of-done requires `lint`, `type-check`, and `test:unit` to pass with `minCoverage: 70` and `stableForDays: 2`. The diagnosis playbook includes runbook entries for two recurring failures: auth rate-limiting tripping `makeUser()` in integration tests, and OS inotify watch limits blocking `next dev --turbopack`.

### Documentation files

- `README.md` (4.0 KB) — project overview, stack summary, shipped feature list, prerequisites (Node 20+, Docker, Supabase CLI), quickstart, test commands, CI description, `db:reset` usage, and directory layout. Primary onboarding document.
- `DEPLOYMENT.md` (9.3 KB) — end-to-end checklist for production deployment to Supabase Cloud plus Vercel. Covers Supabase project provisioning, schema push, Vercel project setup, auth URL configuration, email provider setup, cron setup, signup restriction options, manual storage RLS application, Sentry integration, custom domain, smoke test checklist, day-1 ops checklist, cost estimates ($25–55/month for Pro tiers), and seven common gotchas.
- `PRODUCT.md` (3.5 KB) — product strategy and brand guidelines. Target users: internal team operators. Brand voice: "clinical, fast, quiet." Includes explicit anti-references (visual styles to avoid from Trello, Asana, Monday, Jira, Notion, Linear). Accessibility commitment: WCAG 2.2 AA, `prefers-reduced-motion` support, 32-pixel minimum hit targets.
- `DESIGN.md` (23.9 KB) — full design system specification. YAML frontmatter with color tokens (dark-mode-first), the Geist typography scale, component-level design notes. The source of truth referenced by component implementations.

### Root `hooks/` directory

This directory contains React hooks, not Git hooks. There are 10 TypeScript files (already covered in section 5). There are no Git hooks checked into the repository (no `husky`, no `lefthook`, no shell scripts in this directory).

### Key observations about the infrastructure layer

- **Dual ORM strategy with a deliberate seam.** Drizzle handles all server-action reads and writes; Supabase JS handles only authentication and realtime. `dbAsUser` enforces per-request RLS by injecting JWT claims into `request.jwt.claims` as a transaction-local setting, so RLS policies on the database govern data access without duplicating security logic in application code.
- **Migrations are the sole schema authority.** `drizzle.config.ts` points `out` at `supabase/migrations/`, but `drizzle-kit generate` is never used. The authoritative deployment command is `supabase db push`. Drizzle exists for type-safe query construction, not migration generation.
- **Local development and CI both run the full Supabase Docker stack.** There is no mocking layer for Postgres or authentication in integration tests. CI auto-detects the local credentials via `supabase status -o env` and tears down cleanly with `supabase stop --no-backup`. The cost is longer CI job duration; the benefit is that the integration suite is a reliable oracle of RLS, trigger, and realtime behavior.
- **The cron schedule discrepancy deserves attention.** `DEPLOYMENT.md` says "every 5 minutes," but `vercel.json` schedules `"0 8 * * *"` (daily at 08:00 UTC). The route file even contains `*/5 * * * *` in an inline comment example. The deployed `vercel.json` is the ground truth; the documentation is outdated.
- **Two migrations are intentionally disabled and need manual intervention.** A fresh automated deployment will produce a storage bucket with no explicit RLS policy and an authentication system that accepts any email. Both `0056_auth_domain_allowlist.sql.disabled` and `0057_storage_rls.sql.disabled` must be manually renamed, edited, and applied before production use.

### Improvement opportunities — ranked by expected speed / performance gain

| Rank | Fix | Expected gain | Effort | Location |
|---|---|---|---|---|
| 1 | Enable the Supabase connection pooler (PgBouncer/Supavisor on port 54329) and point `DATABASE_URL` at it in production | 5–20× concurrent request capacity. Biggest single throughput lever in the stack | Low | `supabase/config.toml` + production `DATABASE_URL` |
| 2 | Disable activity and history triggers during bulk operations using `SET LOCAL session_replication_role = 'replica'`, then re-enable | 5–10× faster bulk archive, bulk shift, and seed operations | Medium | `actions/cards.ts:521`, `actions/sprints.ts:175`, `actions/seed.ts` |
| 3 | Add the composite partial index `notifications(user_id, read_at) WHERE read_at IS NULL` | Makes `unreadCount()` and `markAllRead` near-instant at scale | Low | New migration |
| 4 | Add the composite index `card_field_history(card_id, created_at DESC)` | Makes `/api/card-history` lazy fetches fast as history accumulates | Low | New migration |
| 5 | Add the composite index `activity(board_id, created_at DESC)` | Speeds up activity-feed pagination for active boards | Low | New migration |
| 6 | Share a single Supabase Docker stack across the three CI jobs using a service container, instead of starting fresh in each job | Cuts roughly 30–60 s off both the integration and the e2e job runtime each | High | `.github/workflows/ci.yml` |
| 7 | Investigate Playwright flake sources, then set `fullyParallel: true` and run with multiple workers | 2–4× faster end-to-end suite | Medium | `playwright.config.ts` + targeted flaky-spec fixes |
| 8 | Apply migration `0057_storage_rls.sql.disabled` in production (manual SQL Editor step) | Closes the storage RLS hole | Low | Manual SQL Editor + checklist update |
| 9 | Apply migration `0056_auth_domain_allowlist.sql.disabled` in production | Closes the open-signup hole | Low | Manual SQL Editor + checklist update |
| 10 | Fix the cron schedule discrepancy: either set `vercel.json` to `*/5 * * * *` to match the documentation and inline code comment, or update `DEPLOYMENT.md` to reflect the daily 08:00 UTC schedule | Currently per-event email delivery is delayed up to 24 hours instead of 5 minutes | Low | `vercel.json` or `DEPLOYMENT.md:§5b` |
| 11 | Review `REPLICA IDENTITY FULL` settings (migration 0077) and revert to `DEFAULT` on tables where DELETE events do not need the full old row | Reduces WAL volume; cheaper realtime broadcast | Medium | Existing migration + new migration |
| 12 | Add `next/image` remote-pattern configuration so cover-image URLs flow through the Image Optimization pipeline | Smaller cover images, automatic WebP/AVIF, lazy loading | Low | `next.config.ts` |

---

## 9. Recap Tables (Quick Reference)

### Layers overview

| # | Layer | Location | Purpose | Auth model |
|---|---|---|---|---|
| 1 | Frontend route pages | `app/` | Server-rendered shells, route guards, data seeding | `requireUser()` in every page |
| 2 | Frontend interactive UI | `components/`, `stores/`, `hooks/`, `lib/use-*` | Client interactions, optimistic mutations, realtime subscriptions | Derived client-side from RSC seed |
| 3 | Server Actions | `actions/` (33 files) | Mutation entry points | Wrapper authenticates user, RLS authorizes |
| 4 | API and library services | `app/api/`, `lib/` | Cron, signed uploads, lazy fetches, domain computation | Bearer token (cron) or `requireUser` |
| 5 | Data layer and infrastructure | `supabase/`, `lib/db/`, CI configs | Schema, RLS, triggers, deploy pipeline | RLS policies on every table |

### Component counts

| Layer | Count | Examples |
|---|---|---|
| Route segments | About 30 | `(app)/`, `(auth)/`, `b/[boardId]/`, `w/[workspaceId]/`, `dashboards/`, `me/`, `inbox/`, `timeline/`, `workload/`, `settings/` |
| API route handlers | 8 | card-history, cron/send-emails, notifications/digest, notifications/recent, sla/scan, upload, watchers/check, worklogs |
| UI components | About 100 | board (38), dashboard (17), roadmap (13), sprint (11), workspace (11), me (8), nav (5), epic (4), workload (4), ui (about 15) |
| Zustand stores | 2 | board-store, workspace-store |
| Realtime hooks | 10 | board-realtime, workspace-realtime, presence, activity-sync, workload-sync, three membership-sync hooks, workspace-versions, people-cache |
| Server-action files | 33 | workspaces, boards, lists, cards, comments, attachments, sprints, versions, dashboards, gadgets, milestones, labels, watchers, sla, others |
| Domain library modules | 8 | db, queries, supabase, notifications, errors, roadmap, workload, aggregate-kanban, epic, dashboards, rules (types only) |
| Database tables | About 35 | Core entities plus history, junctions, and automation tables |
| SQL migrations | 96 | 0001–0096 (0058 absent), with 2 disabled |

### Authentication and authorization

| Layer | Mechanism | Where it lives |
|---|---|---|
| Session refresh | Cookie refresh via middleware | `middleware.ts` + `lib/supabase/middleware.ts` |
| Route gate | `requireUser()` redirect to `/login` | Every Server Component page |
| Action gate | `requireUser()` + `getSessionToken()` | Every public action wrapper |
| Database authorization | RLS policies via `request.jwt.claims` | `dbAsUser` + `supabase/migrations/0003_rls.sql` and onwards |
| Application-layer role check | `assertCanManageSprints` only | `actions/sprints.ts` (sole exception) |
| Cron authentication | `Authorization: Bearer ${CRON_SECRET}` or `x-cron-key` | `/api/cron/send-emails`, `/api/sla/scan`, `/api/notifications/digest` |
| Upload authorization | Drizzle board-member check then service-role storage URL | `/api/upload` |

### Realtime channels

| Channel | Tables subscribed | Filter | Consumed by |
|---|---|---|---|
| `board:{boardId}` | lists, cards, labels, card_labels, card_members, checklists, checklist_items, comments, attachments, card_links, components, card_components, card_versions | `board_id=eq.{id}` for most tables | `BoardView` via `useBoardRealtime` |
| `board:{boardId}:presence` | Not applicable (Presence channel) | — | `PresenceAvatars` via `useBoardPresence` |
| `ws:{workspaceId}` | cards, sprints, versions, card_versions; plus fan-out subscriptions for lists, card_links, card_members per board | `workspace_id=eq.{id}` for most; per-board for fan-out | `BoardView`, `EpicKanbanShell`, `AllTasksView`, `RoadmapView`, `BacklogClient` |
| Board-scoped activity channel | activity INSERT events | `board_id=eq.{id}` | `ActivityFeedSync` triggers `router.refresh()` |
| Workload channel | cards, card_members | None | `WorkloadView` triggers `router.refresh()` |

### End-to-end request flow

| Step | Component | Action |
|---|---|---|
| 1 | Browser → Vercel Edge | Request reaches middleware |
| 2 | `middleware.ts` | Refresh session cookie, inject `x-pathname` |
| 3 | Server Component | Call `requireUser()`; redirect to `/login` if no session |
| 4 | `lib/queries/*` | Call `dbAsUser(jwt, fn)` |
| 5 | `lib/db/client.ts` | Set Postgres role and JWT claims |
| 6 | Postgres | RLS evaluates as caller, returns rows |
| 7 | RSC streams to client | Client mounts Zustand store from snapshot |
| 8 | Client subscribes to realtime | `supa.realtime.setAuth(token)` then subscribe channels |
| 9 | User performs action | Optimistic local update + server action call |
| 10 | Postgres trigger | CDC publication broadcasts change |
| 11 | All clients receive event | `rowTo*` deserializer updates store |
| 12 | Optionally | `revalidatePath` invalidates RSC cache |

---

## 10. Known Gaps and Risks

The list below highlights known weaknesses or sharp edges discovered during this review. They are not blockers; they are items to track.

1. **The rules engine has no runtime evaluator.** `lib/rules/types.ts` defines the full `RuleEvent | RuleTrigger | RuleConditions | RuleAction` type surface and the `rules` and `rule_runs` schema tables are fully defined, but no execution layer exists yet.
2. **Migration `0056_auth_domain_allowlist.sql.disabled` is not applied automatically.** A fresh production deployment ships with authentication open to any email domain. The deployment checklist (`DEPLOYMENT.md`) calls this out and provides manual instructions.
3. **Migration `0057_storage_rls.sql.disabled` is not applied automatically.** Storage RLS must be applied manually through the Studio SQL Editor because `storage.objects` is owned by `supabase_storage_admin` and cannot be modified through `supabase db push`.
4. **`vercel.json` and `DEPLOYMENT.md` disagree on the email cron schedule.** `vercel.json` defines `"0 8 * * *"` (daily at 08:00 UTC); the documentation says "every 5 minutes." `vercel.json` is the source of truth.
5. **Service-role client construction is duplicated four times.** There is no shared `lib/supabase/service-role.ts` wrapper; each call site constructs its own `createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`. Credential rotation requires updating four files.
6. **Email label maps are duplicated.** `VERB_BY_KIND` in `lib/notify-email.ts` and `KIND_LABEL` in `lib/notifications/email-digest.ts` are intentionally separate, so the two email paths can be deployed independently. Adding a new notification kind requires updating both files; otherwise labels drift.
7. **The authentication boundary is application-layer only.** A missed `requireUser()` call would silently expose a route, since middleware does not redirect unauthenticated users. There is no catch-all network gate.
8. **Some mutations deliberately skip `revalidatePath`.** Examples include `deleteComment`, `deleteWorklog`, `toggleCardMember`, and `watchCard`. The trade-off is that the RSC cache may temporarily show stale data on direct navigation. Most cases are covered by optimistic UI on the originating client and CDC for other clients.
9. **There are no structured error types.** All RLS-blocked writes throw `new Error("Forbidden")`. Clients cannot distinguish "access denied" from "not found." A structured error type or error code enum at the boundary would improve UX for edge cases.
10. **The demo seeder swallows partial failures.** `actions/seed.ts` uses a `safe()` helper that logs non-fatal errors and continues, which means a partially seeded workspace appears as if seeding succeeded. The user is never told that something failed.
