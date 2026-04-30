# Plan #16 — Dashboards + Gadgets

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Configurable dashboards. A user (or workspace) owns multiple dashboards. Each dashboard contains gadgets — small chart/list widgets that aggregate data across the workspace. Gadgets are positioned on a CSS grid; user can add/remove/move/resize via a drag-to-position editor.

**Gadget types in v1 (8):**
1. `count` — single big number ("Open cards", "My assignments", "Overdue", configurable scope).
2. `recent_activity` — last N activity rows (workspace-scoped, optional board filter).
3. `assigned_to_me` — list of cards assigned to the viewer.
4. `due_this_week` — list of cards with due_date within next 7 days.
5. `velocity` — bar chart of last N completed sprints (story-points completed).
6. `burndown` — line chart for the workspace's currently-active sprint.
7. `cards_by_type` — pie chart counts of `epic | story | task | subtask | bug`.
8. `markdown_note` — static markdown string the user enters.

**Out of scope (deferred):**
- Custom user-defined queries as gadget data sources (post-#15 JQL).
- Cumulative-flow / control-chart (more complex; can be added later as new types).
- Per-gadget cache; everything queries live each request.
- Real drag-to-resize via mouse (use a discrete size dropdown: 1×1 / 2×1 / 2×2).

**Definition of done:**
- New page `/dashboards` lists user's dashboards.
- New page `/dashboards/[id]` renders the dashboard.
- "+ New dashboard" button creates a personal dashboard.
- Inside a dashboard, "+ Add gadget" dropdown lets you pick a type, configure (size + scope + type-specific options), insert.
- Gadgets render real data from existing tables (no new data required).
- Each gadget has a small overflow menu: Edit / Move up / Move down / Delete.
- Owner can set scope = personal (only they see it) OR workspace (any workspace member sees it). Workspace dashboards listed under that workspace.
- Realtime not required for v1 — users refresh to see fresh charts.
- All existing 113 integration + 6 E2E tests still pass. New integration tests cover dashboard + gadget CRUD + RLS.

---

## File structure

**Migrations:**
- `supabase/migrations/0034_dashboards.sql` — `dashboards` table + RLS.
- `supabase/migrations/0035_gadgets.sql` — `gadgets` table + RLS.

**Schema:** append `dashboardScope` pgEnum, `dashboards`, `gadgets` tables.

**Validation:**
- `lib/validation.ts` — `DashboardScope`, `CreateDashboardInput`, `UpdateDashboardInput`, `DeleteDashboardInput`, `CreateGadgetInput`, `UpdateGadgetInput`, `MoveGadgetInput`, `DeleteGadgetInput`, `GadgetType`.

**Server actions:**
- `actions/dashboards.ts` — create / rename / delete / move gadget / etc.
- `actions/gadgets.ts` — addGadget / updateGadget / removeGadget / reorderGadget.

**Read helpers:**
- `lib/queries/dashboards.ts` — `listDashboards(token)`, `getDashboard(token, id)`, `listGadgetsForDashboard(token, dashboardId)`.

**Gadget data resolvers (one per type):**
- `lib/dashboards/resolvers.ts` — async fns that take `(token, gadgetConfig)` and return the gadget's data shape.
  - `resolveCount(token, { scope, what })` → `{ value: number; label: string }`.
  - `resolveRecentActivity(token, { workspaceId, limit })` → list of activity rows.
  - `resolveAssignedToMe(token, userId, { workspaceId? })` → list of cards.
  - `resolveDueThisWeek(token, userId, { workspaceId? })` → list.
  - `resolveVelocity(token, { workspaceId, n })` → reuse `computeVelocity` from plan #12.
  - `resolveBurndown(token, { workspaceId })` → finds active sprint then `computeBurndown(sprintId)`.
  - `resolveCardsByType(token, { workspaceId })` → `{ epic: n, story: n, task: n, subtask: n, bug: n }`.
  - `resolveMarkdownNote(_, { body }: { body: string })` → `{ body }`.

**Components:**
- `app/(app)/dashboards/page.tsx` (server) — list user's dashboards.
- `app/(app)/dashboards/[dashboardId]/page.tsx` (server) — render dashboard with gadgets.
- `components/dashboard/dashboard-grid.tsx` (server) — fetches all gadgets in parallel, calls resolvers, renders grid.
- `components/dashboard/gadget-{type}.tsx` — one per gadget type (8 small components).
- `components/dashboard/add-gadget-dialog.tsx` (client).
- `components/dashboard/gadget-actions.tsx` (client) — edit/move/delete dropdown per gadget.

**Tests:**
- `tests/integration/dashboards.test.ts` — CRUD + scope RLS + gadget add/move/delete.
- `tests/unit/gadget-resolvers.test.ts` — resolveCardsByType + resolveMarkdownNote (pure / minimal-side).

**Modify:**
- `components/nav/top-nav.tsx` — add `DASHBOARDS` link (always visible; not workspace-scoped since personal dashboards exist too).

---

## Task 1 — Migrations + schema

`supabase/migrations/0034_dashboards.sql`:

```sql
create type public.dashboard_scope as enum ('personal','workspace');

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scope public.dashboard_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'personal' and workspace_id is null)
    or (scope = 'workspace' and workspace_id is not null)
  )
);
create index on public.dashboards (owner_id) where scope = 'personal';
create index on public.dashboards (workspace_id) where scope = 'workspace';

alter table public.dashboards enable row level security;

-- READ: owner OR (workspace dashboard AND user is workspace member)
create policy dashboards_select on public.dashboards for select
  using (
    dashboards.owner_id = auth.uid()
    or (dashboards.scope = 'workspace' and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = dashboards.workspace_id and wm.user_id = auth.uid()
    ))
  );

-- INSERT: owner_id must equal caller; workspace dashboards require workspace membership.
create policy dashboards_owner_insert on public.dashboards for insert
  with check (
    dashboards.owner_id = auth.uid()
    and (
      dashboards.scope = 'personal'
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = dashboards.workspace_id and wm.user_id = auth.uid()
      )
    )
  );

-- UPDATE / DELETE: only owner.
create policy dashboards_owner_update on public.dashboards for update
  using (dashboards.owner_id = auth.uid())
  with check (dashboards.owner_id = auth.uid());
create policy dashboards_owner_delete on public.dashboards for delete
  using (dashboards.owner_id = auth.uid());
```

`supabase/migrations/0035_gadgets.sql`:

```sql
create table public.gadgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  type text not null check (type in (
    'count','recent_activity','assigned_to_me','due_this_week',
    'velocity','burndown','cards_by_type','markdown_note'
  )),
  config jsonb not null default '{}'::jsonb,
  position int not null default 0,
  size text not null default '1x1' check (size in ('1x1','2x1','2x2','3x1','3x2')),
  created_at timestamptz not null default now()
);
create index on public.gadgets (dashboard_id, position);

alter table public.gadgets enable row level security;

-- Read piggy-backs on dashboard read; write piggy-backs on dashboard ownership.
create policy gadgets_select on public.gadgets for select
  using (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id
      and (
        d.owner_id = auth.uid()
        or (d.scope = 'workspace' and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = d.workspace_id and wm.user_id = auth.uid()
        ))
      )
  ));

create policy gadgets_owner_write on public.gadgets for all
  using (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id and d.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.dashboards d
    where d.id = gadgets.dashboard_id and d.owner_id = auth.uid()
  ));
```

**Drizzle (append):**

```ts
export const dashboardScope = pgEnum("dashboard_scope", ["personal","workspace"]);

export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  scope: dashboardScope("scope").notNull(),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gadgets = pgTable("gadgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  position: integer("position").notNull().default(0),
  size: text("size").notNull().default("1x1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Apply migrations + restart kong + verify all 113 tests still pass.

**Commit:** `feat(db): dashboards + gadgets tables + RLS`.

---

## Task 2 — Validation + actions

`lib/validation.ts`:

```ts
export const DashboardScope = z.enum(["personal","workspace"]);

export const CreateDashboardInput = z.object({
  name: z.string().trim().min(1).max(120),
  scope: DashboardScope,
  workspaceId: Uuid.nullable().optional(),
}).refine(
  (v) => (v.scope === "personal" && !v.workspaceId) || (v.scope === "workspace" && !!v.workspaceId),
  { message: "workspaceId required for workspace scope" },
);

export const UpdateDashboardInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(120).optional(),
});

export const DeleteDashboardInput = z.object({ id: Uuid });

export const GadgetType = z.enum([
  "count","recent_activity","assigned_to_me","due_this_week",
  "velocity","burndown","cards_by_type","markdown_note",
]);

export const GadgetSize = z.enum(["1x1","2x1","2x2","3x1","3x2"]);

export const CreateGadgetInput = z.object({
  dashboardId: Uuid,
  type: GadgetType,
  config: z.record(z.string(), z.unknown()).default({}),
  size: GadgetSize.default("1x1"),
});

export const UpdateGadgetInput = z.object({
  id: Uuid,
  config: z.record(z.string(), z.unknown()).optional(),
  size: GadgetSize.optional(),
});

export const MoveGadgetInput = z.object({
  id: Uuid,
  direction: z.enum(["up","down"]),
});

export const DeleteGadgetInput = z.object({ id: Uuid });
```

**Action files:**

`actions/dashboards.ts`:
- `createDashboardImpl(token, input)` → INSERT with `ownerId = decodeJwt(token).sub`.
- `updateDashboardImpl(token, input)` → UPDATE merging patch + bump `updatedAt = now()`.
- `deleteDashboardImpl(token, input)` → DELETE; throw if not owner.

Wrappers call `requireUser` + `getSessionToken` + impl + `revalidatePath`.

`actions/gadgets.ts`:
- `createGadgetImpl(token, input)` → SELECT max(position) FROM gadgets WHERE dashboard_id; INSERT new gadget at `position = max+1`.
- `updateGadgetImpl(token, input)` → UPDATE merging patch.
- `removeGadgetImpl(token, input)` → DELETE.
- `moveGadgetImpl(token, { id, direction })` → fetch all gadgets in dashboard ordered by position; find current; swap position with neighbor in `direction`.

**Commit:** `feat(dashboards+gadgets): validation + CRUD + move actions`.

---

## Task 3 — Read helpers

`lib/queries/dashboards.ts`:

```ts
export async function listDashboards(token: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(dashboards).orderBy(asc(dashboards.name))
  );
}

export async function getDashboard(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select().from(dashboards).where(eq(dashboards.id, id));
    return row ?? null;
  });
}

export async function listGadgetsForDashboard(token: string, dashboardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(gadgets)
      .where(eq(gadgets.dashboardId, dashboardId))
      .orderBy(asc(gadgets.position))
  );
}
```

**Commit:** `feat(queries): listDashboards + getDashboard + listGadgetsForDashboard`.

---

## Task 4 — Gadget resolvers

`lib/dashboards/resolvers.ts`:

```ts
import { eq, and, desc, asc, gte, lte, isNotNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  cards, boards, lists, sprints, activity, profiles, cardMembers, workspaceMembers,
} from "@/lib/db/schema";
import { computeBurndown, computeVelocity } from "@/lib/queries/sprints-stats";

export type CountConfig = {
  what: "open_cards" | "overdue" | "my_assignments" | "completed_this_week";
  workspaceId?: string;
};

export async function resolveCount(token: string, userId: string, c: CountConfig) {
  return dbAsUser(token, async (tx) => {
    let where: ReturnType<typeof and> | undefined;
    let label = "Cards";
    switch (c.what) {
      case "open_cards":
        where = eq(cards.archived, false);
        label = "Open cards";
        break;
      case "overdue":
        where = and(
          eq(cards.archived, false),
          eq(cards.dueComplete, false),
          isNotNull(cards.dueDate),
          lte(cards.dueDate, new Date()),
        );
        label = "Overdue";
        break;
      case "my_assignments":
        where = eq(cards.archived, false);
        label = "Assigned to me";
        break;
      case "completed_this_week": {
        const sevenAgo = new Date(Date.now() - 7*24*3600*1000);
        where = and(
          eq(cards.archived, true),
          gte(cards.createdAt, sevenAgo),
        );
        label = "Done this week";
        break;
      }
    }
    let q = tx.select({ n: sql<number>`count(*)::int` }).from(cards);
    if (c.what === "my_assignments") {
      q = q.innerJoin(cardMembers, and(
        eq(cardMembers.cardId, cards.id), eq(cardMembers.userId, userId)
      ));
    }
    if (c.workspaceId) {
      q = q.innerJoin(boards, eq(boards.id, cards.boardId))
           .where(and(where, eq(boards.workspaceId, c.workspaceId)));
    } else {
      q = q.where(where!);
    }
    const [row] = await q;
    return { value: row?.n ?? 0, label };
  });
}

export type RecentActivityConfig = { workspaceId?: string; limit?: number };
export async function resolveRecentActivity(token: string, c: RecentActivityConfig) {
  return dbAsUser(token, async (tx) => {
    let q = tx.select({
      id: activity.id, type: activity.type, payload: activity.payload,
      createdAt: activity.createdAt, actorName: profiles.displayName,
    }).from(activity).leftJoin(profiles, eq(profiles.id, activity.actorId))
    .orderBy(desc(activity.createdAt)).limit(c.limit ?? 10);
    if (c.workspaceId) {
      q = q.innerJoin(boards, eq(boards.id, activity.boardId))
           .where(eq(boards.workspaceId, c.workspaceId));
    }
    return q;
  });
}

export type AssignedConfig = { workspaceId?: string };
export async function resolveAssignedToMe(token: string, userId: string, c: AssignedConfig) {
  return dbAsUser(token, async (tx) => {
    let q = tx.select({
      id: cards.id, title: cards.title, boardId: cards.boardId,
      dueDate: cards.dueDate, type: cards.type,
      boardTitle: boards.title,
    })
    .from(cards)
    .innerJoin(cardMembers, and(eq(cardMembers.cardId, cards.id), eq(cardMembers.userId, userId)))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(eq(cards.archived, false))
    .orderBy(asc(cards.dueDate))
    .limit(20);
    if (c.workspaceId) q = q.where(eq(boards.workspaceId, c.workspaceId));
    return q;
  });
}

export async function resolveDueThisWeek(token: string, _userId: string, c: { workspaceId?: string }) {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return dbAsUser(token, async (tx) => {
    let q = tx.select({
      id: cards.id, title: cards.title, boardId: cards.boardId,
      dueDate: cards.dueDate, type: cards.type, boardTitle: boards.title,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(and(
      eq(cards.archived, false),
      eq(cards.dueComplete, false),
      isNotNull(cards.dueDate),
      gte(cards.dueDate, now),
      lte(cards.dueDate, week),
    ))
    .orderBy(asc(cards.dueDate))
    .limit(20);
    if (c.workspaceId) q = q.where(eq(boards.workspaceId, c.workspaceId));
    return q;
  });
}

export async function resolveVelocity(token: string, c: { workspaceId: string; n?: number }) {
  return computeVelocity(token, c.workspaceId, c.n ?? 6);
}

export async function resolveBurndown(token: string, c: { workspaceId: string }) {
  return dbAsUser(token, async (tx) => {
    const [active] = await tx.select({ id: sprints.id }).from(sprints)
      .where(and(eq(sprints.workspaceId, c.workspaceId), eq(sprints.state, "active")))
      .limit(1);
    if (!active) return null;
    return computeBurndown(token, active.id);
  });
}

export async function resolveCardsByType(token: string, c: { workspaceId?: string }) {
  return dbAsUser(token, async (tx) => {
    let q = tx.select({
      type: cards.type, n: sql<number>`count(*)::int`,
    })
    .from(cards)
    .groupBy(cards.type);
    if (c.workspaceId) {
      q = q.innerJoin(boards, eq(boards.id, cards.boardId))
           .where(and(eq(cards.archived, false), eq(boards.workspaceId, c.workspaceId)));
    } else {
      q = q.where(eq(cards.archived, false));
    }
    const rows = await q;
    const out: Record<string, number> = { epic: 0, story: 0, task: 0, subtask: 0, bug: 0 };
    for (const r of rows) out[r.type] = r.n;
    return out;
  });
}

export function resolveMarkdownNote(_t: string, c: { body: string }) {
  return Promise.resolve({ body: c.body ?? "" });
}
```

**Commit:** `feat(dashboards): 8 gadget resolvers (count/recent/assigned/due/velocity/burndown/by-type/markdown)`.

---

## Task 5 — Tests

`tests/integration/dashboards.test.ts` (5 tests):

1. **Personal dashboard create + list** — owner creates, user list returns it.
2. **Workspace dashboard visible to other members** — owner creates `scope=workspace`; second user (member) calls `listDashboards` and sees it.
3. **Personal dashboard NOT visible to other users** — second user (different workspace) cannot read.
4. **Add + move + delete gadget** — add 3 gadgets; move middle up; verify positions; delete; verify gone.
5. **Non-owner cannot delete** — second user calls `deleteDashboardImpl` on owner's dashboard → reject.

`tests/unit/gadget-resolvers.test.ts`:

- `resolveMarkdownNote` returns body unchanged.
- `resolveCardsByType` shape — pure mocked test using a minimal stub: skipped or done as integration test against real DB.

Run: `npm run test:unit` → ~118 expected (113 + 5 + maybe 1).

**Commit:** `test(dashboards): CRUD + scope RLS + gadget add/move/delete`.

---

## Task 6 — UI: list page + dashboard detail page

`app/(app)/dashboards/page.tsx` (server):

```tsx
import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listDashboards } from "@/lib/queries/dashboards";
import { CreateDashboardButton } from "@/components/dashboard/create-dashboard-dialog";

export default async function DashboardsPage() {
  await requireUser();
  const token = (await getSessionToken())!;
  const list = await listDashboards(token);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="serif-display text-3xl">Dashboards</h1>
        <CreateDashboardButton />
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((d) => (
          <li key={d.id}>
            <Link href={`/dashboards/${d.id}`} className="glass rounded-2xl p-5 block hover:-translate-y-0.5 transition-all">
              <div className="mono-meta text-fg-faint">{d.scope.toUpperCase()}</div>
              <h2 className="serif-display text-2xl mt-2">{d.name}</h2>
            </Link>
          </li>
        ))}
        {list.length === 0 && (
          <li className="col-span-full text-center text-fg-muted py-20">
            <p className="pull-quote text-3xl">No dashboards yet.</p>
            <p className="mono-meta-sm mt-3">Use the button above to create one.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
```

`components/dashboard/create-dashboard-dialog.tsx` (client) — name input + scope toggle (personal / workspace) + workspace picker (only when scope=workspace, fetched via supabase browser client OR pass in workspaces from server prop). Submit → `createDashboard` + `router.push(/dashboards/${id})`.

`app/(app)/dashboards/[dashboardId]/page.tsx` (server):

```tsx
export default async function DashboardPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const dash = await getDashboard(token, dashboardId);
  if (!dash) notFound();
  const isOwner = dash.ownerId === user.id;
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <div className="mono-meta-sm text-fg-faint">{dash.scope.toUpperCase()} DASHBOARD</div>
          <h1 className="serif-display text-3xl mt-1">{dash.name}</h1>
        </div>
        {isOwner && <AddGadgetButton dashboardId={dashboardId} workspaceId={dash.workspaceId} />}
      </header>
      <DashboardGrid dashboardId={dashboardId} ownerId={dash.ownerId} viewerId={user.id} workspaceId={dash.workspaceId} />
    </div>
  );
}
```

`components/dashboard/dashboard-grid.tsx` (server):

Fetches gadgets, dispatches each to its renderer. Renders into a CSS grid where each gadget occupies 1-3 columns × 1-2 rows based on `size`.

**Commit:** `feat(dashboards): /dashboards list + /dashboards/[id] page + DashboardGrid`.

---

## Task 7 — Gadget components (8 small files)

For each type, a tiny server (or client where interactive) component that takes resolved data + renders.

- `components/dashboard/gadgets/gadget-shell.tsx` — wrapper with title + actions menu.
- `components/dashboard/gadgets/gadget-count.tsx` — big number + label.
- `components/dashboard/gadgets/gadget-recent-activity.tsx` — list of activity rows.
- `components/dashboard/gadgets/gadget-assigned-to-me.tsx` — list of cards.
- `components/dashboard/gadgets/gadget-due-this-week.tsx` — list of cards.
- `components/dashboard/gadgets/gadget-velocity.tsx` — reuse `<VelocityStrip>` from plan #12.
- `components/dashboard/gadgets/gadget-burndown.tsx` — reuse `<BurndownChart>` from plan #12.
- `components/dashboard/gadgets/gadget-cards-by-type.tsx` — small SVG bar chart (5 bars).
- `components/dashboard/gadgets/gadget-markdown-note.tsx` — render markdown via simple regex (bold/italic/links/headings — no full md lib; minimal).

`components/dashboard/gadget-actions.tsx` (client) — dropdown with Edit / Move up / Move down / Delete. Edit opens the same dialog used to add (prefilled).

`components/dashboard/add-gadget-dialog.tsx` (client) — picks type, then renders type-specific config form (e.g. count → `what` dropdown; markdown → `body` textarea).

**Commit:** `feat(dashboards): 8 gadget components + shell + actions menu + add/edit dialog`.

---

## Task 8 — Top nav + final wiring

Modify `components/nav/top-nav.tsx`: add a `DASHBOARDS` link always visible (next to logout? or after BACKLOG/VERSIONS/ROADMAP). Since dashboards are user-scoped, no `activeWorkspaceId` requirement.

**Commit:** `feat(nav): DASHBOARDS link in top nav`.

---

## Task 9 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean. New routes:
  - `/dashboards`
  - `/dashboards/[dashboardId]`
- `npm run test:unit` → 118+ expected.
- `npx playwright test` → 6 still green.
- Manual smoke:
  - Create personal dashboard "Sprint health".
  - Add Velocity gadget (workspace = current ws, n=6) → renders bar chart.
  - Add Burndown gadget → renders chart for active sprint.
  - Add Count gadget (overdue) → big number.
  - Add Markdown note → renders.
  - Move/delete gadgets.

---

## Self-Review Notes

- **Spec coverage:** roadmap §Reports-1 (dashboards + gadgets) — fully implemented for v1 (8 gadget types).
- **Out of scope (deferred):** real drag-to-position grid (uses size dropdown + move-up/down only), per-gadget caching, JQL-driven gadgets (#15), CSV/XLSX export from a gadget (#17).
- **Performance:** each dashboard render runs 1 SQL per gadget. Worst case 10-20 gadgets × ~50ms = up to 1s render. Acceptable for v1; React 19's `Promise.all` orchestration in `<DashboardGrid>` parallelises.
- **Markdown rendering minimalism:** intentionally avoid `react-markdown` to skip the dep. Inline regex covers headings, bold, italic, links. Markdown-note gadgets are typically short — fine.
- **No realtime:** dashboards don't auto-refresh. Users reload. Plan #16b can add `revalidate: 30` or websocket invalidation.
