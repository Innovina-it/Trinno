# Link entity — design

**Date:** 2026-06-02
**Status:** Draft (pending user review)
**Author:** Ali + Claude

## 1. Goal

Add a single **`link`** entity to the app. A link is a URL with management rules:

- **Read** (see + open/use the link by clicking its icon): **all** workspace profiles, including `guest`.
- **Write** (create / edit / delete, including changing the diamond colour): **only `owner` and `admin`** of the workspace. `member` and `guest` are read-only on links.

One entity, two attachment scopes:

- **Workspace scope** — one link per workspace, pointing at a shared project folder. Rendered as a **cloud ("nuvoletta")** icon next to the active workspace name.
- **Card scope** — one link per card. Rendered as a coloured **diamond ("rombo")** in the task views.

> Distinct from the existing `card_links` table, which models card-to-card relations
> (`blocks` / `relates_to` / …). This feature adds a **new** `links` table and a new
> `actions/links.ts` module. Naming kept separate to avoid confusion.

## 2. Decisions captured (from brainstorming)

| Topic | Decision |
|---|---|
| Data model | **Dedicated polymorphic `links` table** (Option B) |
| Card link cardinality | 1 link per card, single URL |
| Card text box | 3-line auto-grow textarea, auto-wrap, holds the URL |
| Edit gesture | **Press & hold ~500ms** on the icon (pointer); short click = open |
| Workspace link | 1 per workspace, URL only (no colour) |
| Workspace icon | **Cloud ("nuvoletta")**; **hidden entirely when no link is set** |
| Workspace create/manage | In **workspace settings** (cloud is absent when empty, so it can't be the create entry) |
| Card empty-state | **Chain ("catena")** icon for editors → click opens the dialog (create); becomes diamond once set |
| Card create entry points | Quick view **and** extended edit window |
| Write permission | **owner + admin only**; member + guest read-only |
| Delete | Dedicated **"Rimuovi"** button in the dialog |
| Colour palette | `giallo, arancione, blu, rosso, verde` + custom hex slot (picker). Default = **giallo** |
| Realtime | **Yes**, like cards — `links` added to the realtime publication |

## 3. Icon-state model

### Card (quick view + extended edit)
| User / state | Icon | Click | Hold ~500ms |
|---|---|---|---|
| owner/admin, **no link** | 🔗 chain | opens dialog (create) | — |
| owner/admin, **link set** | ◆ diamond (colour) | opens URL | opens dialog (edit) |
| member/guest, **link set** | ◆ diamond (colour) | opens URL | — (no-op) |
| member/guest, **no link** | (nothing) | — | — |

Removing the link via the dialog reverts the icon to 🔗 for editors, or removes it for others.

### Card (tile / gantt / list)
Only the ◆ diamond, only when a link exists. No chain affordance in these views.
Click opens URL; hold opens the edit dialog when the user can edit.

### Workspace (next to active name in the switcher)
| User / state | Icon | Click | Hold ~500ms |
|---|---|---|---|
| anyone, **no link** | (nothing) | — | — |
| any member, **link set** | ☁ cloud (nuvoletta) | opens URL | — |
| owner/admin, **link set** | ☁ cloud | opens URL | opens dialog (edit, URL only) |

Initial creation of the workspace link happens in **workspace settings**, not via the icon
(the icon does not exist while the value is empty).

## 4. Data model — `links` table

Migration `supabase/migrations/0121_links.sql`:

```sql
create type public.link_scope as enum ('workspace','card');

create table public.links (
  id           uuid primary key default gen_random_uuid(),
  scope        public.link_scope not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id      uuid references public.cards(id) on delete cascade,
  url          text not null,
  color        text,                    -- card scope only; null for workspace
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint links_scope_shape check (
    (scope = 'workspace' and card_id is null and color is null) or
    (scope = 'card'      and card_id is not null)
  )
);

-- 1:1 per owner
create unique index links_ws_ux   on public.links(workspace_id) where scope = 'workspace';
create unique index links_card_ux on public.links(card_id)      where scope = 'card';
```

- For **card scope**, `workspace_id` is set by a **trigger** resolving `card → board → workspace`
  (mirrors the existing `card_links.board_id` trigger pattern).
- `alter table public.links replica identity full;` so realtime delete events carry the row
  (pattern from `0077_realtime_delete_identity.sql`).
- `updated_at` maintained by trigger (existing pattern).

### RLS (defense in depth — RLS **and** a TS guard, matching the existing convention)

```sql
alter table public.links enable row level security;

-- READ: any workspace member (incl. guest)
create policy links_select on public.links for select using (
  workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()
  )
);

-- WRITE: owner/admin only
create policy links_write on public.links for all using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = links.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
) with check (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = links.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);
```

### Realtime
Add `links` to the realtime publication (pattern from `0104_realtime_boards_publication.sql`
/ `0092_realtime_history_tables.sql`).

## 5. Server actions — `actions/links.ts`

```
upsertCardLink(cardId, { url, color })   -> create or update the card's link
removeCardLink(cardId)                   -> delete
upsertWorkspaceLink(workspaceId, { url })-> create or update the workspace folder link
removeWorkspaceLink(workspaceId)         -> delete
```

Each follows the established flow:
`requireUser()` → `getSessionToken()` → `dbAsUser(token, tx => …)` →
`assertWorkspaceWriter(role)` → upsert/delete → `revalidatePath(...)` → `actionResult` wrapper.

- New permission helper `assertWorkspaceWriter(role)` in `lib/permissions/` — throws
  `ACCESS_DENIED` unless role ∈ `{owner, admin}`. Reuses `getWorkspaceRole` /
  `getWorkspaceRoleForCard` from `lib/permissions/guest-guard.ts`.
- Zod schemas in `lib/validation`:
  - `url`: trimmed; if no scheme, prepend `https://`; must parse as a valid URL.
  - `color`: one of the palette names/hex, or a custom `#rrggbb`.

## 6. Colour palette

Shared TS constant (e.g. `lib/links/colors.ts`):

```
LINK_COLORS = [
  { key: 'giallo',    hex: '#facc15' },
  { key: 'arancione', hex: '#fb923c' },
  { key: 'blu',       hex: '#3b82f6' },
  { key: 'rosso',     hex: '#ef4444' },
  { key: 'verde',     hex: '#22c55e' },
]
DEFAULT_LINK_COLOR = 'giallo'
```
Plus a custom hex slot via a colour picker. Storage = hex string. Exact hex values to be
aligned with `DESIGN.md` / `globals.css` tokens during implementation.

## 7. Shared UI — `components/links/`

- **`useLongPress`** (hook, `lib/hooks/use-long-press.ts`): distinguishes a short click
  (≤500ms) from a hold (~500ms); suppresses the click-open when a hold fired; supports
  mouse + touch. Pure logic → unit-testable.
- **`LinkIcon`**: renders chain / diamond / cloud per scope + state + colour. Click → open
  URL (`window.open(url, '_blank', 'noopener,noreferrer')`); hold → `onEdit` (only when
  `canEdit`). Chain variant: single click → `onEdit` (create).
- **`LinkEditDialog`**: 3-line auto-grow + wrapping textarea (URL); colour selector (5 swatches
  + custom picker, **card scope only**); **Rimuovi** button; **Close→Save** behaviour (the
  primary button reads "Close" until the form is dirty, then becomes "Save"). `scope` prop
  toggles the colour selector. Mirrors the quick-view window's close/save logic.

### Accessibility
Press & hold is pointer-only and not keyboard-reachable. For editors we add a keyboard path:
on keyboard focus of the icon, `Enter` opens the URL and an explicit "Modifica" affordance
(small edit control or context-menu entry) opens the dialog. All icons carry `aria-label` /
`title`. This is a hard requirement, not optional polish.

## 8. Integration points (display)

| View | File | Placement |
|---|---|---|
| Workspace name | `components/workspace/workspace-switcher.tsx` | cloud icon as a **sibling of the trigger** (so its click/hold don't open the menu); **never** inside `DropdownMenuItem`. Switcher gains the active workspace's link + the user's role as props. |
| Workspace settings | `components/workspace/workspace-settings-form.tsx` | create / edit / remove the workspace folder link |
| Card tile | `components/board/card-tile.tsx` | diamond at end of title (if link exists) |
| Quick view | `components/board/card-quick-view.tsx` | chain (empty, editors) / diamond (set); create + edit entry point |
| Extended edit | `components/board/card-modal.tsx` | link section **next to attachments** (`components/board/card/attachments-section.tsx`); create + edit |
| Gantt | `components/roadmap/roadmap-bar.tsx` | diamond at end of the bar, **between task and assignees**; assignees shift right when a link exists |
| Roadmap list | `components/roadmap/roadmap-list-view.tsx` | diamond at end of the title |

## 9. State / realtime wiring

- **Card link**: a slice in `stores/board-store.ts` keyed by `cardId → { url, color }`,
  subscribed to realtime like attachments; optimistic upsert/remove. Tile, quick view,
  modal, gantt and list read from this store (no extra fetch per view).
- **Workspace link**: passed server-side to the switcher; a client subscription in the
  workspace provider keeps the cloud icon live across sessions.

## 10. Testing

- **Unit**: URL validation/normalisation; `links_scope_shape` constraint; `assertWorkspaceWriter`
  (owner/admin pass; member/guest reject); `useLongPress` (click vs hold); dialog dirty→save.
- **E2E (Playwright)**: admin creates a card link from quick view (chain → diamond) and from
  extended edit; diamond appears in tile / gantt / list; click opens a new tab; member sees +
  clicks the diamond but hold does **not** open the dialog; workspace link created in settings →
  nuvoletta appears next to the name; link absent from the switcher dropdown items; realtime
  propagation across two sessions.
- **Note** (project memory): vitest can't transform `@base-ui/react`, so components importing
  `@/components/ui/*` fail unit import-analysis → test `LinkEditDialog` via E2E and keep pure
  logic (hooks, validation) in unit tests.

## 11. Open items for review

1. **Workspace link creation lives in workspace settings** (the cloud icon is hidden while the
   value is empty, so it can't be the create entry). Confirm this is the intended create path.
2. Exact hex values for the 5 palette colours (to be aligned with the design tokens).
