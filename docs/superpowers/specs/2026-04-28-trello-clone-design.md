# Trello Clone — Design Specification

**Date:** 2026-04-28
**Status:** Approved for implementation planning
**Scope:** Full-feature Trello clone (workspaces → boards → lists → cards, with labels, members, checklists, comments, attachments, due dates, activity log, search)

---

## 1. Goals & Non-Goals

### Goals
- Functional parity with Trello's core: workspaces, boards, lists, cards, drag-and-drop reordering across lists.
- Full feature set: labels, card members (assignees), checklists, due dates with completion, comments, file attachments, board-scoped activity log, search across cards.
- Real-time multi-user collaboration: changes by one user appear on other users' screens within ~1 second without manual refresh.
- Presence: see who else is currently viewing a board.
- Authenticated, authorization-enforced at the database layer (RLS).
- Deployable on Vercel free tier with Supabase free tier as the only backend dependency.

### Non-Goals
- Trello "Power-Ups" / plugin system.
- Email notifications, push notifications, mobile native apps.
- Granular per-card permissions (board-level membership is the only ACL).
- Calendar/Gantt/Timeline alternative views (kanban only).
- Import/export from real Trello.
- Offline mode.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router, React 19, Server Actions) |
| Hosting | Vercel |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email + password) |
| Realtime | Supabase Realtime (Postgres CDC + presence channels) |
| File storage | Supabase Storage (`attachments` bucket) |
| ORM | Drizzle ORM (typed queries; RLS enforced via anon JWT) |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` |
| Ordering | `fractional-indexing` (string keys) |
| UI primitives | shadcn/ui on Tailwind CSS |
| State (client) | Zustand for board-local store; React 19 `useOptimistic` for mutations |
| Testing | Vitest (unit + integration) + Playwright (E2E) + `supabase start` local stack |
| CI | GitHub Actions |

Rationale captured in §10.

---

## 3. Architecture

```
Browser
  React 19 + dnd-kit + Tailwind/shadcn
   │
   ├── Server Actions (mutations: create/update/delete/move)
   │      └── Drizzle  →  Supabase Postgres  (RLS enforced via user JWT)
   │
   ├── Server Components (initial board/list/card render on navigation)
   │      └── Drizzle  →  Supabase Postgres
   │
   └── Supabase JS client (subscriptions only)
          ├── postgres_changes channel `board:{id}`  →  live row updates
          └── presence channel `board:{id}`         →  active viewers
Auth: Supabase Auth → JWT in HTTP-only cookie → middleware refreshes →
      passed to both Drizzle (row-level) and supabase-js (subscriptions)
Storage: signed-URL upload flow via /api/upload route
```

Key principles:

- **Mutations are exclusively Server Actions.** No `/api/*` route exists for CRUD. The only API routes are the Supabase auth callback and the Storage signed-URL minting endpoint.
- **Reads are split:** initial board paint is SSR (fast first paint, SEO-irrelevant but consistent rendering); subsequent updates arrive via Supabase Realtime subscriptions on the client.
- **Security boundary is RLS in Postgres**, not application code. Server Actions are the ergonomic boundary; RLS is the enforcement boundary. A bug in a Server Action cannot leak data the user shouldn't see, because Drizzle queries run with the user's JWT.
- **One subscription channel per open board.** Subscribed on mount, unsubscribed on unmount or navigation away.

---

## 4. Data Model

All tables are in `public` schema. `id` is `uuid` default `gen_random_uuid()` unless noted. Timestamps are `timestamptz default now()`.

### 4.1 Tables

```
profiles
  id uuid PK references auth.users(id)
  display_name text not null
  avatar_url text
  created_at

workspaces
  id, name text, owner_id uuid references profiles(id), created_at

workspace_members
  workspace_id, user_id (composite PK), role enum('owner','admin','member')

boards
  id, workspace_id, title,
  background_kind enum('color','image'), background_value text
    -- color: CSS color (e.g. '#0079bf'); image: Supabase Storage path in bucket 'board-backgrounds'
  visibility enum('private','workspace'), created_by, archived bool, created_at

board_members
  board_id, user_id (composite PK), role enum('admin','member','observer')

lists
  id, board_id, title, position text, archived bool

cards
  id, list_id, board_id (denorm, see §5), title, description text,
  position text, due_date timestamptz, due_complete bool,
  cover_color text, archived bool, created_at

labels
  id, board_id, name text, color text

card_labels
  card_id, label_id (composite PK), board_id (denorm)

card_members
  card_id, user_id (composite PK), board_id (denorm)

checklists
  id, card_id, board_id (denorm), title, position text

checklist_items
  id, checklist_id, board_id (denorm), text, completed bool, position text

comments
  id, card_id, board_id (denorm), author_id, body text,
  created_at, edited_at

attachments
  id, card_id, board_id (denorm), storage_path text, filename text,
  mime text, size_bytes int, uploaded_by, created_at

activity
  id, board_id, card_id (nullable), actor_id, type text,
  payload jsonb, created_at
```

### 4.2 Denormalization rationale

Several child tables (`cards`, `card_labels`, `card_members`, `checklists`, `checklist_items`, `comments`, `attachments`) carry a redundant `board_id` column. This is **deliberate** and serves two purposes:

1. **Realtime filter simplicity.** Supabase Realtime filters on `postgres_changes` accept simple equality (`board_id=eq.X`). Without denormalization we would need `list_id=in.(...)` style filters that grow stale when the list set changes.
2. **RLS policy simplicity.** Every policy reduces to `EXISTS (SELECT 1 FROM board_members WHERE board_id = NEW.board_id AND user_id = auth.uid())` — no joins through parent tables.

`board_id` is maintained by `BEFORE INSERT` triggers on each child table (`SELECT board_id FROM <parent>`). On parent move operations (e.g., card moved to a list in another board — not currently a feature, but if added later), an `AFTER UPDATE` trigger cascades.

### 4.3 Ordering

`position` columns use **fractional indexing** (lexicographically-comparable strings, e.g. `"a0"`, `"a1"`, `"a0V"`). Computed by the `fractional-indexing` npm library. Rebalancing strategy in §6.

### 4.4 Indexes

- `cards (board_id, list_id, position)` — board view query
- `cards (list_id, position)` — fallback for list-only fetches
- `lists (board_id, position)`
- `comments (card_id, created_at desc)`
- `activity (board_id, created_at desc)`
- `board_members (user_id)` — RLS membership lookup
- `workspace_members (user_id)`

### 4.5 RLS policies (illustrative)

```sql
-- read: any board the user is a member of
create policy "boards_select_members" on boards for select
using (exists (
  select 1 from board_members
  where board_members.board_id = boards.id
    and board_members.user_id = auth.uid()
));

-- write: only board admins
create policy "boards_update_admins" on boards for update
using (exists (
  select 1 from board_members
  where board_members.board_id = boards.id
    and board_members.user_id = auth.uid()
    and board_members.role = 'admin'
));

-- cards: board membership + denormalized board_id
create policy "cards_select_members" on cards for select
using (exists (
  select 1 from board_members
  where board_members.board_id = cards.board_id
    and board_members.user_id = auth.uid()
));
```

Analogous policies on every table. Public anonymous role has no access.

**Author-only mutations for `comments` and `attachments`:** UPDATE and DELETE policies additionally require `author_id = auth.uid()` (or `uploaded_by = auth.uid()` for attachments). Board admins can DELETE any comment/attachment via a separate admin policy.

**Workspace owners are implicit board admins.** A board policy permitting writes also accepts `EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = boards.workspace_id AND user_id = auth.uid() AND role IN ('owner','admin'))`. This avoids needing to add the workspace owner to every board membership row.

**`activity` is written by triggers, not Server Actions.** `SECURITY DEFINER` trigger functions on `lists`, `cards`, `comments`, `attachments`, `checklists`, `checklist_items`, `card_labels`, `card_members`, and `board_members` insert appropriate rows into `activity`. Therefore `activity` has only a SELECT policy (board members can read); there is no INSERT/UPDATE/DELETE policy for the user role. Triggers run as the owning role and bypass RLS by design. Trigger functions read `auth.uid()` to populate `actor_id`.

---

## 5. Realtime

### 5.1 Channels

Per open board the client opens a single `supabase.channel(\`board:${boardId}\`)` and binds:

- `postgres_changes` for `lists`, `cards`, `labels`, `card_labels`, `card_members`, `checklists`, `checklist_items`, `comments`, `attachments` — all filtered `board_id=eq.${boardId}`.
- `presence` track on the same channel — payload includes `{ userId, displayName, avatarUrl, cursorListId? }`.

### 5.2 Optimistic UI

Each Server Action returns the canonical row. Client flow:

1. User triggers mutation (e.g., drag card).
2. `useOptimistic` reducer mutates local Zustand store immediately.
3. `startTransition` invokes Server Action.
4. On success: server-returned row replaces optimistic entry.
5. CDC echo arrives separately. A monotonic `updated_at`/version check drops echoes older than the local copy.
6. On failure: revert to pre-mutation snapshot, surface toast.

### 5.3 Presence

`useEffect` on board mount: `channel.track({ userId, displayName, avatarUrl })`. Header renders avatar stack from `channel.presenceState()`. On unmount: `channel.untrack()` + `channel.unsubscribe()`.

---

## 6. Drag-and-Drop

### 6.1 Library

`@dnd-kit/core` + `@dnd-kit/sortable`.

### 6.2 Structure

A single `<DndContext collisionDetection={closestCorners}>` wraps the board. Inside:

- One horizontal `<SortableContext strategy={horizontalListSortingStrategy}>` for the row of lists.
- One vertical `<SortableContext strategy={verticalListSortingStrategy}>` per list, containing card tiles.

Cards are draggable across lists because both contexts share the parent `DndContext`.

### 6.3 Position computation

```ts
import { generateKeyBetween } from 'fractional-indexing';

function newPositionFor(prev: Card | null, next: Card | null) {
  return generateKeyBetween(prev?.position ?? null, next?.position ?? null);
}
```

Server Action `moveCard(cardId, toListId, newPosition)` performs `UPDATE cards SET list_id = $2, position = $3, board_id = (SELECT board_id FROM lists WHERE id = $2) WHERE id = $1`. Single statement, atomic.

### 6.4 Concurrency

Two users dragging into the same gap compute keys against their local view of the list. Because `generateKeyBetween` always returns a string strictly between its two arguments, both writes succeed and the resulting order is well-defined (whichever key sorts first wins that slot; the other lands adjacent). No conflict resolution code required.

### 6.5 Rebalancing

Fractional keys grow ~1 char per insert at the same gap. A board-level scheduled task rebalances when any `position` exceeds 32 chars. Implemented as a Server Action `rebalanceList(listId)` that re-issues evenly-spaced keys in a single transaction. Triggered by a Vercel Cron weekly + ad-hoc when client detects a key over the threshold.

---

## 7. Auth

- **Method:** email + password via Supabase Auth.
- **Flow:** signup → email confirmation link → callback at `/auth/callback?code=…` exchanges code for session → cookie set → redirect to workspace home.
- **Session refresh:** `middleware.ts` runs Supabase auth helper on every request; refreshes JWT cookie when near expiry.
- **Profile creation:** Postgres trigger on `auth.users` insert creates matching `profiles` row with `display_name = email-local-part`.
- **Route protection:** `app/(app)/layout.tsx` calls `requireUser()` → redirect `/login` if unauthenticated. RLS provides the actual security; the redirect is UX.

---

## 8. File / Route Structure

```
trello/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (app)/
│   │   ├── layout.tsx                    # auth gate, top nav, workspace switcher
│   │   ├── page.tsx                      # workspace home (board grid)
│   │   ├── w/[workspaceId]/page.tsx
│   │   ├── b/[boardId]/page.tsx          # board view
│   │   ├── b/[boardId]/c/[cardId]/page.tsx  # parallel-route card modal
│   │   └── settings/page.tsx
│   ├── api/upload/route.ts               # signed-URL minting for Storage
│   └── globals.css
│
├── actions/                              # Server Actions
│   ├── boards.ts        # create, rename, archive, invite, change-role
│   ├── lists.ts         # create, rename, move, archive, rebalance
│   ├── cards.ts         # create, update, move, archive, assign, label, due
│   ├── checklists.ts
│   ├── comments.ts
│   ├── attachments.ts
│   └── members.ts
│
├── lib/
│   ├── db/
│   │   ├── client.ts                     # Drizzle + node-postgres → Supabase
│   │   ├── schema.ts                     # all table definitions
│   │   └── migrations/
│   ├── supabase/
│   │   ├── server.ts                     # SSR client (reads cookies)
│   │   ├── browser.ts                    # client-component client
│   │   └── middleware.ts                 # cookie refresh
│   ├── auth.ts                           # getSession, requireUser
│   ├── ordering.ts                       # fractional-indexing helpers + rebalance
│   └── activity.ts                       # log-event helpers
│
├── components/
│   ├── ui/                               # shadcn primitives
│   ├── board/
│   │   ├── board-view.tsx                # client root: DndContext + realtime + store
│   │   ├── list-column.tsx
│   │   ├── card-tile.tsx
│   │   ├── card-modal.tsx
│   │   ├── card-edit/                    # tabs: details, checklists, labels, members, attachments
│   │   ├── label-picker.tsx
│   │   ├── member-picker.tsx
│   │   └── activity-feed.tsx
│   ├── workspace/board-grid.tsx
│   └── nav/top-nav.tsx
│
├── hooks/
│   ├── use-board-realtime.ts             # subscribe + dispatch CDC events into store
│   ├── use-presence.ts
│   └── use-optimistic-board.ts
│
├── stores/
│   └── board-store.ts                    # Zustand: lists/cards keyed by board id
│
├── middleware.ts                         # Supabase auth refresh on every request
├── drizzle.config.ts
├── supabase/
│   ├── migrations/                       # SQL: tables, triggers, RLS policies
│   └── seed.sql
└── tests/
    ├── unit/
    └── e2e/
```

### Module boundaries

- `actions/*` is the only place that mutates the database. Each Server Action calls `requireUser()` first and returns either the canonical row or a typed error.
- `lib/db` depends on nothing in `app/` or `components/`. Schema is the source of truth for types.
- `components/board/board-view.tsx` is the single client root that owns the DnD context, realtime subscription, and Zustand store. All children are presentational and consume the store via selectors.
- `lib/supabase/*` clients are split (server / browser / middleware) per Supabase's required pattern; do not cross-import.

---

## 9. Testing

| Layer | Tool | Scope |
|---|---|---|
| Pure logic | Vitest | `lib/ordering.ts` (fractional indexing wrappers, rebalance), activity payload builders, helper functions |
| Server Actions | Vitest + local Supabase stack | Spin `supabase start`, run actions against real Postgres + RLS using a test JWT, assert row state. No mocks. |
| RLS policies | Vitest hitting Supabase REST with anon JWT | Verify non-member cannot SELECT/UPDATE another board's rows |
| Components | Vitest + React Testing Library | Presentational components only (card-tile, label-picker) |
| End-to-end | Playwright | Golden paths in §9.1 |

### 9.1 E2E golden paths (must pass before merge)

1. Signup → confirm via Inbucket (supabase local) → land on workspace home.
2. Create board → create list → create card → drag card across lists → reload, order persists.
3. Two browser contexts on the same board: user A moves a card → user B sees the move within 1 second.
4. Add a label, checklist, comment, and attachment to a card → reload, all persist.
5. Non-member visiting a board URL receives 404 (RLS hides it; no 403 leak).

### 9.2 CI

GitHub Actions matrix:
- `unit`: Vitest, no services.
- `integration`: boots `supabase start`, runs Vitest integration suite.
- `e2e`: boots Supabase + `next start`, runs Playwright headlessly.
- Caches: `~/.npm`, `.next/cache`, Playwright browsers.

### 9.3 Policy: no DB mocks

Server Actions and policy tests run against a real Supabase Postgres instance. Mocks for Postgres + RLS provide false confidence; the local stack is fast enough for CI.

---

## 10. Decision Log

- **Next.js fullstack over split frontend/backend.** One repo, one deploy. Server Actions remove the boilerplate that previously motivated tRPC. Split would add CORS, two deploys, and shared-types ceremony with no benefit at this scale.
- **Vercel + Supabase over self-hosted.** Free tier covers the project; Supabase bundles Postgres + Auth + Realtime + Storage so there is one external dependency rather than four.
- **Drizzle over Prisma over Supabase-client-only.** Prisma typically uses the service role and bypasses RLS, shifting security into application code. Supabase client alone lacks ergonomic typed queries. Drizzle preserves RLS (queries run with the user JWT) and provides full TypeScript inference.
- **Supabase Realtime over Socket.IO/Pusher.** Supabase Realtime is included in the free tier and integrates directly with Postgres CDC and RLS. Socket.IO would require a long-running Node process incompatible with Vercel serverless.
- **Fractional indexing over integer positions.** Integer positions force re-indexing of all subsequent rows on every insert/move and create write conflicts when two clients reorder simultaneously. Fractional keys eliminate both.
- **Denormalized `board_id` on child tables.** Justified by realtime filter simplicity and RLS policy simplicity (§4.2). Cost is a single trigger per child table.
- **One Zustand store per board, not global.** Boards are independent; a global store would force all components to re-render on any board change.
- **Email+password auth only.** OAuth and magic link can be added later without schema changes since Supabase Auth handles them all under the same `auth.users` table.

---

## 11. Out of Scope (explicitly deferred)

- Power-Ups / plugin architecture
- Email and push notifications
- Mobile native apps (web is responsive but not native)
- Calendar / Timeline / Dashboard alternative views
- Per-card permissions (board-level only)
- Trello import/export
- Offline mode and conflict resolution beyond what fractional indexing provides
- Internationalization (English only)
- Theming beyond the shadcn light/dark default

These may be considered in follow-up specs.
