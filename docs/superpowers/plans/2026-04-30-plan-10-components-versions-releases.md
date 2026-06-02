# Plan #10 — Components, Versions, Releases

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Two new structural primitives:
- **Components** are sub-areas of a project (e.g. "auth", "billing", "ui-shell"). Board-scoped. A board admin defines components; a card may be tagged with multiple. Each component may name a lead user.
- **Versions / Releases** are workspace-scoped milestones (e.g. "v1.4.0", "Q3 2026"). Each version has a state (`unreleased | released | archived`) and an optional release date. A card may be tagged with one or more versions, each with a `kind` of `affects` (the bug was found in that version) or `fixes` (the work targets that version).

A **release page** at `/w/[wsId]/versions/[versionId]` lists all cards that target the version with progress (count + story-point completion), and offers an auto-drafted markdown release-notes export (cards w/ `fixes` grouped by component).

**Out of scope (deferred):**
- Component-aware dashboards / charts (that's plan #16).
- Multi-version semver auto-bump.
- Linking components to GitHub repos / paths (plan #21).

**Definition of done:**
- Board admin creates `auth` component on board X. Cards on board X gain a "Components" multi-select that includes `auth`.
- Workspace admin creates version `v1.4.0` on workspace W. Card modal in any board within W gains a "Versions" section with `affects` + `fixes` pickers.
- `/w/[wsId]/versions/[versionId]` shows a header (name, semver, state, release date), aggregate progress, and a card list grouped by component, with `affects/fixes` kind chips per row.
- "Export release notes" button on the release page → opens a markdown blob in a new tab.
- All mutations RLS-enforced. Components: board members read, board admins write. Versions: workspace members read, workspace admins write. Junctions: board members read; board members write to junctions on cards within their boards (component) or workspace members write to versions junctions for cards within boards in the same workspace.
- New integration tests cover the four happy paths + four RLS denials.
- All existing 79 integration + 6 E2E tests still pass.

---

## File structure

**Migrations:**
- `supabase/migrations/0030_components.sql` — components + card_components, RLS, denorm trigger, publication.
- `supabase/migrations/0031_versions.sql` — versions + card_versions, RLS, denorm trigger, publication.

**Schema:** append `components`, `cardComponents`, `versions`, `cardVersions` + `versionState`, `cardVersionKind` pgEnums to `lib/db/schema.ts`.

**Validation:** `lib/validation.ts` — `CreateComponent`, `UpdateComponent`, `DeleteComponent`, `ToggleCardComponent`, `CreateVersion`, `UpdateVersion`, `DeleteVersion`, `SetCardVersion`, `ClearCardVersion`.

**Server actions (impl/wrapper split):**
- `actions/components.ts`
- `actions/card-components.ts`
- `actions/versions.ts`
- `actions/card-versions.ts`

**Read helpers:**
- `lib/queries/components.ts` — `listComponents(token, boardId)`.
- `lib/queries/versions.ts` — `listVersions(token, workspaceId)`, `getVersion(token, id)`, `listVersionCards(token, versionId)`, `releaseNotesMarkdown(...)`.

**Snapshot extension (board-snapshot already loads board-scoped data):**
- `lib/queries/board-snapshot.ts` — add `components: ComponentRow[]`, `cardComponents: CardComponentRow[]`, `cardVersions: CardVersionRow[]` (versions themselves are workspace-scoped, fetched separately into the modal).

**Realtime hook:** subscribe to `components`, `card_components`, `versions`, `card_versions`. Add `rowToComponent`, `rowToCardComponent`, `rowToCardVersion` mappers.

**Store:** add collections + idempotent mutators:
- `components: ComponentRow[]` + `addComponent`, `updateComponent`, `removeComponent`.
- `cardComponents: CardComponentRow[]` + `addCardComponent`, `removeCardComponent`.
- `cardVersions: CardVersionRow[]` + `addCardVersion`, `removeCardVersion`.

**Components / pages:**
- `components/components/components-panel.tsx` (server) — used in board settings.
- `components/components/component-card-section.tsx` (client) — used in card modal.
- `components/versions/versions-panel.tsx` (server) — used in workspace settings.
- `components/versions/version-card-section.tsx` (client) — used in card modal.
- `app/(app)/w/[workspaceId]/versions/page.tsx` — versions list.
- `app/(app)/w/[workspaceId]/versions/[versionId]/page.tsx` — release page.
- `app/(app)/w/[workspaceId]/versions/[versionId]/release-notes/route.ts` — markdown export GET.

**Tests:**
- `tests/integration/components.test.ts`
- `tests/integration/versions.test.ts`

---

## Task 1 — Migrations + Drizzle schema

`supabase/migrations/0030_components.sql`:

```sql
create table public.components (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  lead_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index components_board_name_unique on public.components (board_id, lower(name));
create index on public.components (board_id);

create table public.card_components (
  card_id uuid not null references public.cards(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, component_id)
);
create index on public.card_components (board_id);
create index on public.card_components (component_id);

-- Denorm board_id from cards on every insert/update
create or replace function public.set_card_component_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end$$;
create trigger card_components_set_board_id
  before insert or update of card_id on public.card_components
  for each row execute function public.set_card_component_board_id();

alter table public.components enable row level security;
alter table public.card_components enable row level security;

-- READ: board members (workspace-visible boards too)
create policy components_select on public.components for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

-- WRITE: board admins (or workspace owner/admin via existing escalation)
create policy components_admin_write on public.components for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = components.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = components.board_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ));

-- card_components: read = board members; write = board members
create policy card_components_select on public.card_components for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_components.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = card_components.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

create policy card_components_member_write on public.card_components for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_components.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = card_components.card_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.components;
alter publication supabase_realtime add table public.card_components;
```

`supabase/migrations/0031_versions.sql`:

```sql
create type public.version_state as enum ('unreleased','released','archived');
create type public.card_version_kind as enum ('affects','fixes');

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  semver text,
  state public.version_state not null default 'unreleased',
  release_date timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index versions_workspace_name_unique on public.versions (workspace_id, lower(name));
create index on public.versions (workspace_id, state);

create table public.card_versions (
  card_id uuid not null references public.cards(id) on delete cascade,
  version_id uuid not null references public.versions(id) on delete cascade,
  kind public.card_version_kind not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  primary key (card_id, version_id, kind)
);
create index on public.card_versions (workspace_id);
create index on public.card_versions (version_id, kind);

-- Denorm workspace_id from cards.list_id → list.board_id → board.workspace_id
create or replace function public.set_card_version_workspace_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare wsid uuid;
begin
  select b.workspace_id into wsid
  from public.cards c
  join public.boards b on b.id = c.board_id
  where c.id = new.card_id;
  if wsid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.workspace_id := wsid;
  return new;
end$$;
create trigger card_versions_set_workspace_id
  before insert or update of card_id on public.card_versions
  for each row execute function public.set_card_version_workspace_id();

alter table public.versions enable row level security;
alter table public.card_versions enable row level security;

-- versions read: workspace members
create policy versions_select on public.versions for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid()
  ));

-- versions write: workspace owner/admin
create policy versions_admin_write on public.versions for all
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = versions.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ));

-- card_versions read: workspace members of the card's workspace
create policy card_versions_select on public.card_versions for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = card_versions.workspace_id and wm.user_id = auth.uid()
  ));

-- card_versions write: any workspace member can attach versions to cards in boards they can read
create policy card_versions_member_write on public.card_versions for all
  using (exists (
    select 1 from public.cards c
    join public.boards b on b.id = c.board_id
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where c.id = card_versions.card_id and wm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.boards b on b.id = c.board_id
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where c.id = card_versions.card_id and wm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.versions;
alter publication supabase_realtime add table public.card_versions;
```

**Drizzle (append to `lib/db/schema.ts`):**

```ts
export const components = pgTable("components", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  leadUserId: uuid("lead_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardComponents = pgTable(
  "card_components",
  {
    cardId: uuid("card_id").notNull(),
    componentId: uuid("component_id").notNull(),
    boardId: uuid("board_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.componentId] }) }),
);

export const versionState = pgEnum("version_state", [
  "unreleased",
  "released",
  "archived",
]);

export const cardVersionKind = pgEnum("card_version_kind", [
  "affects",
  "fixes",
]);

export const versions = pgTable("versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  semver: text("semver"),
  state: versionState("state").notNull().default("unreleased"),
  releaseDate: timestamp("release_date", { withTimezone: true }),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardVersions = pgTable(
  "card_versions",
  {
    cardId: uuid("card_id").notNull(),
    versionId: uuid("version_id").notNull(),
    kind: cardVersionKind("kind").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.versionId, t.kind] }) }),
);
```

Apply: `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`. 79 tests still pass.

**Commit:** `feat(db): components + versions + card_components + card_versions tables`.

---

## Task 2 — Validation + actions

`lib/validation.ts` (append):

```ts
export const CreateComponentInput = z.object({
  boardId: Uuid,
  name: z.string().trim().min(1).max(60),
  leadUserId: Uuid.nullable().optional(),
});
export const UpdateComponentInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(60).optional(),
  leadUserId: Uuid.nullable().optional(),
});
export const DeleteComponentInput = z.object({ id: Uuid });
export const ToggleCardComponentInput = z.object({ cardId: Uuid, componentId: Uuid });

export const CreateVersionInput = z.object({
  workspaceId: Uuid,
  name: z.string().trim().min(1).max(60),
  semver: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  releaseDate: z.union([z.string(), z.date()]).nullable().optional(),
});
export const UpdateVersionInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(60).optional(),
  semver: z.string().trim().max(40).nullable().optional(),
  state: z.enum(["unreleased","released","archived"]).optional(),
  releaseDate: z.union([z.string(), z.date()]).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export const DeleteVersionInput = z.object({ id: Uuid });
export const SetCardVersionInput = z.object({
  cardId: Uuid,
  versionId: Uuid,
  kind: z.enum(["affects","fixes"]),
});
export const ClearCardVersionInput = z.object({
  cardId: Uuid,
  versionId: Uuid,
  kind: z.enum(["affects","fixes"]),
});
```

**Action files (4):** `actions/components.ts`, `actions/card-components.ts`, `actions/versions.ts`, `actions/card-versions.ts`. Each uses the impl/wrapper pattern established by previous plans:

- `createComponentImpl` → INSERT, return row.
- `updateComponentImpl` → UPDATE merging patch fields.
- `deleteComponentImpl` → DELETE, throw "Forbidden" if zero rows affected.
- `toggleCardComponentImpl` → SELECT existing; if exists, DELETE; else INSERT with placeholder boardId (trigger overwrites).
- `createVersionImpl`, `updateVersionImpl`, `deleteVersionImpl` → same shape; on `state=released` and no `releaseDate`, set `releaseDate = now()` server-side. On `updateVersion` always bump `updatedAt = now()`.
- `setCardVersionImpl` (kind = affects | fixes) → INSERT ON CONFLICT DO NOTHING with placeholder workspaceId.
- `clearCardVersionImpl` → DELETE matching `(cardId, versionId, kind)`.

Wrappers call `requireUser()` + `getSessionToken()` + impl, then `revalidatePath(...)` for the appropriate page.

**Commit:** `feat(components+versions): validation + CRUD actions (impl/wrapper)`.

---

## Task 3 — Snapshot, store, realtime mappers

Extend `lib/queries/board-snapshot.ts`:

```ts
export type ComponentRow = typeof components.$inferSelect;
export type CardComponentRow = typeof cardComponents.$inferSelect;
export type CardVersionRow = typeof cardVersions.$inferSelect;
```

Add to `BoardSnapshot.collections` + parallel fetch:

```ts
tx.select().from(components).where(eq(components.boardId, boardId)),
tx.select().from(cardComponents).where(eq(cardComponents.boardId, boardId)),
tx.select().from(cardVersions).where(eq(cardVersions.workspaceId, board.workspaceId)),
```

(Last one needs board's workspace_id which is already in scope.)

Extend `stores/board-store.ts`:

```ts
components: ComponentRow[];
cardComponents: CardComponentRow[];
cardVersions: CardVersionRow[];

addComponent(c) / updateComponent(id, patch) / removeComponent(id)
addCardComponent(x) / removeCardComponent(cardId, componentId)
addCardVersion(x) / removeCardVersion(cardId, versionId, kind)
```

All idempotent (skip duplicates on add).

Extend `hooks/use-board-realtime.ts` with subscriptions to: `components` (filter `board_id=eq.${boardId}`), `card_components` (filter `board_id=eq.${boardId}`), `card_versions` (filter `workspace_id=eq.${workspaceId}` — needs board's workspaceId passed into the hook OR derived from the snapshot stored elsewhere). Provide `rowToComponent`, `rowToCardComponent`, `rowToCardVersion` mappers.

For workspace-scoped `versions` table: subscribe in a separate hook used at workspace level (used by versions list page + workspace settings + card modal version picker). Don't add to `useBoardRealtime` — versions are not board-bound. Create `hooks/use-workspace-versions.ts` that returns `versions: VersionRow[]` with realtime updates.

**Commit:** `feat(snapshot): components + cardComponents + cardVersions in board snapshot; store + realtime mappers; useWorkspaceVersions hook`.

---

## Task 4 — Read helpers

`lib/queries/components.ts`:

```ts
export async function listComponents(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(components)
      .where(eq(components.boardId, boardId))
      .orderBy(asc(components.name))
  );
}
```

`lib/queries/versions.ts`:

```ts
export async function listVersions(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(versions)
      .where(eq(versions.workspaceId, workspaceId))
      .orderBy(asc(versions.releaseDate), asc(versions.name))
  );
}

export async function getVersion(token: string, id: string) { ... }

export async function listVersionCards(token: string, versionId: string) {
  // Join card_versions ↔ cards ↔ boards ↔ card_components ↔ components,
  // then group component names server-side. Return one row per (card, kind).
  return dbAsUser(token, async (tx) => { ... });
}

export async function releaseNotesMarkdown(token: string, versionId: string): Promise<string> {
  const version = await getVersion(token, versionId);
  const cards = await listVersionCards(token, versionId);
  const fixes = cards.filter(c => c.kind === "fixes");
  const grouped = groupBy(fixes, c => c.componentName ?? "Uncategorised");
  // Render markdown:
  //   # v1.4.0 — 2026-04-30
  //   ## auth
  //   - [TR-AAAAAA](https://...) Add 2FA setup wizard
  //   ## billing
  //   - ...
  return md;
}
```

**Commit:** `feat(queries): components + versions read helpers + releaseNotesMarkdown`.

---

## Task 5 — Tests (TDD)

`tests/integration/components.test.ts` (5 tests):

1. **Create + toggle on card** — owner creates `auth` component on board; toggles onto a card; row appears in `card_components` with correct denorm `board_id`.
2. **Toggle off on second call** — same call removes the row.
3. **Update / delete** — rename `auth` → `authn`; delete cascades the junction.
4. **Non-admin write denied** — workspace-member-but-not-board-admin user creates a component → reject.
5. **Cross-board denied** — owner of board A creates a component on board A; user on board B (different workspace) tries to insert junction with that component → reject.

`tests/integration/versions.test.ts` (5 tests):

1. **Create + state transition** — owner creates `v1.0.0`; updates state to `released` → `releaseDate` populated.
2. **Card attach affects + fixes** — card gains both rows; junction has correct `kind`.
3. **Clear release date when going back to unreleased** — accept that we don't auto-clear; assert it stays.
4. **Non-admin write denied** — workspace member (non-admin) tries to create a version → reject.
5. **Cross-workspace denied** — user from workspace A tries to attach version-A to a card in workspace-B board → reject.

Run integration suite — 89 expected (79 + 5 + 5). `npm run test:unit`.

**Commit:** `test(components+versions): CRUD + RLS denial paths`.

---

## Task 6 — UI: Workspace versions panel

`components/versions/versions-panel.tsx` (server) — fetches versions, renders table:

| Name | Semver | State | Release date | Cards (fixes) | Actions |

Plus "Create version" button → opens a small client `CreateVersionDialog` that posts to `createVersion`. Inline edit dropdowns for `state` (post `updateVersion`).

`app/(app)/w/[workspaceId]/settings/page.tsx` — append a `<section>` containing `<VersionsPanel workspaceId={workspaceId} />`.

**Commit:** `feat(versions): workspace settings — versions panel + create dialog`.

---

## Task 7 — UI: Board components panel

`components/components/components-panel.tsx` (server) — fetches components for board, renders chips list with inline rename + remove + lead-user picker. Add via small client `AddComponentForm` (single inline input + Add).

`app/(app)/b/[boardId]/settings/page.tsx` — append `<section><ComponentsPanel boardId={boardId} /></section>`.

**Commit:** `feat(components): board settings — components panel`.

---

## Task 8 — UI: Card modal sections

`components/components/component-card-section.tsx` (client):
- Read `components` + `cardComponents` from store.
- Filter components for this card (set of componentIds attached).
- Render existing chips + "+" button → opens DropdownMenu with all components, click toggles.
- Optimistic add/remove via store mutators + `toggleCardComponent` action.

`components/versions/version-card-section.tsx` (client):
- Use `useWorkspaceVersions(workspaceId)` to get all versions in scope.
- Read `cardVersions` from store filtered by cardId.
- Two sub-rows: "Affects" and "Fixes". Each row: list of attached version chips + "+ pick version" dropdown.
- Optimistic via store + `setCardVersion` / `clearCardVersion` actions.

Modify `components/board/card-modal.tsx`:
- Insert `<ComponentCardSection cardId={card.id} />` near labels section.
- Insert `<VersionCardSection cardId={card.id} workspaceId={workspaceId} />` below.

The card modal already receives boardId; thread workspaceId from the route page. Both intercepted (`@modal/(.)c/[cardId]/page.tsx`) and standalone (`c/[cardId]/page.tsx`) need the new prop.

**Commit:** `feat(card-ui): component multi-select + affects/fixes version pickers in card modal`.

---

## Task 9 — UI: Versions list + release page

`app/(app)/w/[workspaceId]/versions/page.tsx` — server, renders all versions in workspace as cards (name + state badge + release date + counts). Each card links to detail page. "+ New version" button (reuses dialog from Task 6).

`app/(app)/w/[workspaceId]/versions/[versionId]/page.tsx` — server. Fetch `version`, `versionCards` (joined with components + boards). Render:
- Header: Name (serif-display), semver chip, state badge, release date, description.
- Aggregate strip: total cards / fixes / affects / story-points completed (sum of `story_points` where `archived=true` for `fixes` cards) / total story points.
- Body: cards grouped by component (`Uncategorised` group last). Each row: kind chip (`FIXES` / `AFFECTS`), card title (linked to `/b/{boardId}/c/{cardId}`), board name, parent breadcrumb if subtask.
- Footer: "Export release notes (markdown)" → `<a href="/w/{ws}/versions/{v}/release-notes" target="_blank">`.

Top nav (or workspace home header) gets a "Versions" link to `/w/{ws}/versions`.

**Commit:** `feat(versions): list page + release detail page with grouping + progress`.

---

## Task 10 — Markdown export route

`app/(app)/w/[workspaceId]/versions/[versionId]/release-notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { releaseNotesMarkdown } from "@/lib/queries/versions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string; versionId: string }> },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const { versionId } = await params;
  const md = await releaseNotesMarkdown(token, versionId);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="release-notes.md"`,
    },
  });
}
```

**Commit:** `feat(versions): release-notes markdown export route`.

---

## Task 11 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean. New routes:
  - `/w/[workspaceId]/versions`
  - `/w/[workspaceId]/versions/[versionId]`
  - `/w/[workspaceId]/versions/[versionId]/release-notes`
- `npm run test:unit` → **89 passing** (79 + 5 components + 5 versions).
- `npx playwright test` → 6 passing (no regression).
- Manual smoke:
  - Create version `v0.1` in workspace; toggle a few cards `fixes`/`affects`; open release page; click export → markdown opens with grouped fixes.

---

## Self-Review Notes

- **Spec coverage:** roadmap §Structure-3 (components, versions, releases) — fully implemented including release-notes export.
- **Out of scope (deferred):** component-aware dashboards (plan #16), GitHub repo linking (plan #21), semver auto-bump.
- **Tile decoration:** intentionally omitted to keep the tile clean. Cards in a release are visible on the release page; modal exposes assignments.
- **Workspace-scoped realtime:** `useWorkspaceVersions` opens a separate channel per workspace. Fine because versions list page + card modal need it; doesn't conflict with `useBoardRealtime`.
- **`releaseNotesMarkdown` performance:** runs N+1 db trips by design (small N). Versions with thousands of cards → upgrade to a single SQL with array-aggregation in plan #16 if it bites.
- **`releaseDate` auto-set:** only on `state=released` transition where caller didn't supply one. Other transitions don't touch it.
