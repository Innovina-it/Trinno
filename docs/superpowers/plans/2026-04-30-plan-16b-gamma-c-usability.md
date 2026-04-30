# Plan #16b-γ-C — Usability quick wins

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** 8 small UX wins. No big refactor.

| Item | Files |
|---|---|
| #25 priority field | migration; schema; validation; updateCard; tile; modal section |
| #26 cover image/color | migration; schema; validation; updateCard; tile; modal section |
| #27 virtualize lists > 100 cards | `components/board/list-column.tsx` |
| #29 favorite boards | migration `board_favorites`; actions; nav |
| #30 recently viewed | migration `recent_views`; trigger or app-side; nav dropdown |
| #34 persistent error pane | client provider listening to all action errors |
| #35 empty roadmap state | `components/roadmap/roadmap-view.tsx` |
| #36 empty inbox state explainer | `app/(app)/inbox/page.tsx` |

## Tasks

### Task 1 — Priority field

`supabase/migrations/0040_card_priority.sql`:

```sql
create type public.card_priority as enum ('p0','p1','p2','p3','p4');

alter table public.cards
  add column priority public.card_priority;

create index on public.cards (board_id, priority);
```

Drizzle: `cardPriority = pgEnum(...)`, `priority: cardPriority("priority")` on cards.

Validation: extend `UpdateCardInput` with `priority: z.enum([...]).nullable().optional()`.

Action: `updateCardImpl` patch passes through.

`useBoardRealtime` rowToCard mapper: include `priority: r.priority ?? null`.

UI:
- `components/board/card/priority-picker.tsx` — chip with dropdown. Icons: red dot for p0, orange p1, yellow p2, gray p3, gray-faded p4.
- Mount in card modal next to TypePicker.
- `components/board/card-tile.tsx` — render priority chip in metadata row when set. Use single character: `P0` … `P4`. Color tint by level (red/orange/yellow/dim/dim).

Commit: `feat(cards): priority enum + picker + tile chip`.

### Task 2 — Cover (color or image)

`supabase/migrations/0041_card_cover.sql`:

```sql
alter table public.cards
  add column cover_kind text check (cover_kind in ('none','color','image')) default 'none' not null,
  add column cover_value text;
```

Validation: extend `UpdateCardInput` with `coverKind: z.enum(['none','color','image']).optional()`, `coverValue: z.string().max(500).nullable().optional()`.

UI:
- `components/board/card/cover-picker.tsx` — palette of 6 monochrome shades + "Upload image" button (uses `/api/upload` route, mints signed URL, registers as attachment-of-kind=cover OR stores path directly in `cover_value`).
- `components/board/card-tile.tsx` — when `coverKind=color`, render top stripe of the chosen color (height 32px). When `coverKind=image`, render image as background-image of top of tile (height 100px).
- Card modal — show cover above title.

Commit: `feat(cards): cover (color or image) + tile rendering`.

### Task 3 — Virtualize cards > 100 per list

For lists with > 100 visible cards, use windowing. No new dep — write a small inline implementation in `components/board/list-column.tsx`:

```ts
const VIRTUALIZE_THRESHOLD = 100;
const ITEM_HEIGHT_ESTIMATE = 96; // px per card
// If listCards.length > threshold, render only cards in viewport ± buffer.
// Track scroll position via ref. Recompute on scroll.
```

Or simpler: only render first 100 + a "Show all (N more)" chip at bottom. When clicked, render all. Document that as v1; full virtualization deferred.

Commit: `feat(board): cap rendered cards per list at 100 with show-all toggle`.

### Task 4 — Favorite boards

Migration `0042_board_favorites.sql`:

```sql
create table public.board_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

alter table public.board_favorites enable row level security;
create policy fav_select on public.board_favorites for select
  using (user_id = auth.uid());
create policy fav_insert on public.board_favorites for insert
  with check (user_id = auth.uid()
    and exists (select 1 from public.board_members bm
                where bm.board_id = board_favorites.board_id and bm.user_id = auth.uid()));
create policy fav_delete on public.board_favorites for delete
  using (user_id = auth.uid());
```

Drizzle: `boardFavorites` table.

Validation: `ToggleFavoriteBoardInput = z.object({ boardId: Uuid })`.

Action: `toggleFavoriteBoardImpl(token, { boardId })` — INSERT ... ON CONFLICT DO NOTHING; if existed, DELETE. Returns `{ favorited: boolean }`.

UI:
- Star icon on board grid tiles. Click toggles. Filled = favorited.
- Star icon in `BoardSettingsForm` header.
- TopNav: dropdown "Favorites" listing favorited boards (workspace-scoped — show all favorites across workspaces).

Commit: `feat(favorites): toggle action + star on tiles + nav dropdown`.

### Task 5 — Recently viewed

Migration `0043_recent_views.sql`:

```sql
create table public.recent_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
create index on public.recent_views (user_id, viewed_at desc);

alter table public.recent_views enable row level security;
create policy rv_select on public.recent_views for select using (user_id = auth.uid());
create policy rv_upsert on public.recent_views for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

App-side: every visit to `/b/{boardId}` upserts `(user_id, board_id, now())`. Implement via a server action call in `app/(app)/b/[boardId]/page.tsx` (no need for a separate API — fire-and-forget after the snapshot fetch).

Action `recordBoardViewImpl(token, { boardId })`.

UI: TopNav dropdown "Recent" listing last 5 views (oldest pruned automatically by query order).

Commit: `feat(recents): record board views + nav dropdown of last 5`.

### Task 6 — Persistent error pane

Today server-action errors → `toast.error(...)`. Issue: toasts fade after 4-6s; user misses them.

Add a global error bus:
- `components/error-pane.tsx` (client) mounted in root layout: collapsible bar at top of viewport that lists all unresolved errors. Each entry has Retry button + Dismiss.
- `lib/errors/error-bus.ts` (client) — simple event emitter `errorBus.push({ id, message, retry?, ts })`. Subscribers receive updates.
- Modify `toast.error` call sites to ALSO push to error bus when error severity is high (e.g. mutation failures, retryable).

For v1: just add the pane, mount in `app/(app)/layout.tsx`, expose `errorBus.push` for callers. Don't migrate every existing call site — just the most user-facing ones (`updateCard`, `moveCard`, `createCard`, etc.).

Commit: `feat(errors): persistent error pane + error bus`.

### Task 7 — Empty roadmap state

When `cards.length === 0` OR no cards have dates:

```tsx
{visibleCards.length === 0 && (
  <div className="absolute inset-0 grid place-items-center text-center">
    <div className="space-y-3 max-w-md">
      <p className="serif-display text-4xl">No scheduled work yet.</p>
      <p className="text-sm text-fg-muted">
        Open any epic or story and set a start + target date in the Roadmap section
        of its card modal. Your bars will appear here.
      </p>
    </div>
  </div>
)}
```

Commit: `feat(roadmap): empty state with CTA copy`.

### Task 8 — Empty inbox state explainer

In `app/(app)/inbox/page.tsx`:

```tsx
{notifications.length === 0 && (
  <div className="text-center py-20 space-y-4 max-w-md mx-auto">
    <p className="serif-display text-3xl">All caught up.</p>
    <p className="mono-meta-sm text-fg-muted">
      You'll be notified when:
    </p>
    <ul className="text-sm text-fg-muted space-y-1">
      <li>• someone @mentions you in a comment</li>
      <li>• a card you watch is assigned, archived, or rescheduled</li>
      <li>• a due date you own arrives</li>
    </ul>
    <Link href="/settings/notifications" className="mono-meta-sm underline">
      Manage notification settings →
    </Link>
  </div>
)}
```

(Don't need actual settings page for this slice — link can 404 or stub.)

Commit: `feat(inbox): empty state explainer`.

### Task 9 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm run test:unit` (no new tests for this slice; existing 139 still pass).
- `npx playwright test` 10 still green.

## Constraints

- No new deps. Lucide icons + base-ui.
- Cover images upload via existing `/api/upload` flow (Plan #5).
- Virtualization is "show first 100 + show-all toggle" — full virt deferred.
- Recent_views table: each user's own rows, RLS gates.
- Favorites: same.
- Error pane: simple collapsible bar; not a modal.

## Self-Review Notes

- **Priority colors break monochrome rule** (red/orange/yellow). This is the second exception (after blocked status). Acceptable: priority is semantic warning.
- **Cover stripe height 32px** keeps tile compact. Cover image height 100px is bigger — only show if user opted in.
- **Favorites are per-user** (not per-workspace). Cross-workspace pinned set.
- **Recent views capped at 5** in nav; full history not exposed.
- **Persistent error pane** only handles new errors going forward; existing toast call sites can opt in over time.
