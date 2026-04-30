# Plan #11 — Sprints + Backlog

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Workspaces gain sprints (planned / active / completed). Cards may be assigned to a sprint or live in the backlog. New `/w/:wsId/backlog` page lets the user plan sprints, drag cards between backlog and sprint, start a sprint, and complete one.

**Architecture:** Sprints are workspace-scoped (a workspace's boards share sprints — Jira-style). A workspace has at most one active sprint at a time (partial unique index). Cards get an optional `sprint_id` FK. Backlog page enumerates all cards across the workspace's boards that the user can read, grouped by sprint state.

**Out of scope:** sprint goals burndown chart (plan #12), velocity (plan #12), sprint reports (plan #16), drag-cards-into-sprint via DnD (this plan uses click-to-assign menus; DnD on backlog can land in a polish slice).

**Definition of done:**
- Workspace has a Backlog page accessible from top nav (link added).
- Page shows: Active sprint (top, or empty state), planned sprints (collapsed), backlog (bottom, grouped by board).
- "+ New sprint" button → modal → name + goal + dates → planned state.
- "Start sprint" button (on a planned sprint) → moves it to active. If another sprint is already active, blocks with toast.
- "Complete sprint" button (on the active one) → completes it; cards still in lists move to next planned sprint or back to backlog (user picks).
- Each card row in backlog/sprint has a sprint dropdown that switches the card's sprint.
- Card modal shows sprint chip + dropdown to change.
- Existing 48 integration + 6 E2E tests still pass.
- 5 new integration tests cover: sprint CRUD, partial unique active rule, card.sprint_id assign, sprint completion flow.

---

## Files

**Migration:** `supabase/migrations/0020_sprints.sql`

**Schema:** `lib/db/schema.ts` — `sprints` table + extend `cards.sprint_id`.

**Validation:** `lib/validation.ts` — `SprintState`, `CreateSprintInput`, `UpdateSprintInput`, `DeleteSprintInput`, `StartSprintInput`, `CompleteSprintInput`, `AssignCardToSprintInput`.

**Server actions:** `actions/sprints.ts` — full CRUD + start + complete + assign-card-to-sprint.

**Read helpers:**
- `lib/queries/sprints.ts` — `listSprintsForWorkspace`, `getActiveSprint`.
- Extend `lib/queries/board-snapshot.ts` `CardRow` with `sprintId`.

**Store:** Cards already have `updateCard(id, patch)` so `sprintId` mutates through the existing API once added to type. Sprints aren't streamed via realtime in this slice — sprint mutations happen on the backlog page which re-fetches on action.

**Realtime:** extend `rowToCard` in `hooks/use-board-realtime.ts` to include `sprintId`.

**Routes:**
- `app/(app)/w/[workspaceId]/backlog/page.tsx` — new.

**Components:**
- `components/sprint/sprint-card.tsx` — single sprint panel (header + cards list + actions).
- `components/sprint/backlog-list.tsx` — backlog cards grouped by board.
- `components/sprint/create-sprint-dialog.tsx`.
- `components/sprint/complete-sprint-dialog.tsx` — pick where incomplete cards go.
- `components/sprint/sprint-picker.tsx` — used in card modal + per-card menu.

**Modify:**
- `components/board/card-modal.tsx` — render `<SprintPicker cardId={...} />` near labels/due.
- `components/nav/top-nav.tsx` — add "Backlog" link when on a workspace.

**Tests:** `tests/integration/sprints.test.ts`.

---

## Task 1: Migration + schema

`supabase/migrations/0020_sprints.sql`:

```sql
create type public.sprint_state as enum ('planned', 'active', 'completed');

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  goal text,
  start_date timestamptz,
  end_date timestamptz,
  state public.sprint_state not null default 'planned',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.sprints (workspace_id, state);

-- One active sprint per workspace.
create unique index sprints_one_active_per_workspace
  on public.sprints (workspace_id)
  where state = 'active';

alter table public.cards
  add column sprint_id uuid references public.sprints(id) on delete set null;
create index on public.cards (sprint_id) where sprint_id is not null;

-- Trigger: card and sprint must share workspace.
create or replace function public.cards_validate_sprint()
returns trigger language plpgsql as $$
declare
  card_ws uuid;
  sprint_ws uuid;
begin
  if new.sprint_id is null then return new; end if;
  select w.id into card_ws
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
    where b.id = new.board_id;
  select workspace_id into sprint_ws from public.sprints where id = new.sprint_id;
  if sprint_ws is null then
    raise exception 'cards: sprint_id % not found', new.sprint_id;
  end if;
  if card_ws is null or card_ws <> sprint_ws then
    raise exception 'cards: sprint must be in the same workspace';
  end if;
  return new;
end$$;

create trigger cards_validate_sprint_biu
  before insert or update of sprint_id on public.cards
  for each row execute function public.cards_validate_sprint();

-- RLS for sprints: workspace members read; admins write.
alter table public.sprints enable row level security;

create policy sprints_select on public.sprints for select
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id and m.user_id = auth.uid())
  );

create policy sprints_admin_write on public.sprints for all
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id
              and m.user_id = auth.uid() and m.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = sprints.workspace_id
              and m.user_id = auth.uid() and m.role in ('owner','admin'))
  );

alter publication supabase_realtime add table public.sprints;
```

Drizzle (append to `lib/db/schema.ts`, after existing tables):

```ts
export const sprintState = pgEnum("sprint_state", ["planned", "active", "completed"]);

export const sprints = pgTable("sprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  goal: text("goal"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  state: sprintState("state").notNull().default("planned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
```

Add `sprintId: uuid("sprint_id")` to the `cards` table columns object.

`supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`. Run all integration tests; 48 still green.

Commit: `feat(db): sprints table + cards.sprint_id with workspace + active-uniqueness guards`

---

## Task 2: Validation + actions

Append to `lib/validation.ts`:

```ts
export const SprintStateZ = z.enum(["planned", "active", "completed"]);
export const CreateSprintInput = z.object({
  workspaceId: Uuid,
  name: Title,
  goal: z.string().trim().max(500).optional().nullable(),
  startDate: z.union([z.string(), z.date()]).optional().nullable(),
  endDate: z.union([z.string(), z.date()]).optional().nullable(),
});
export const UpdateSprintInput = z.object({
  id: Uuid,
  name: Title.optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  startDate: z.union([z.string(), z.date()]).nullable().optional(),
  endDate: z.union([z.string(), z.date()]).nullable().optional(),
});
export const DeleteSprintInput = z.object({ id: Uuid });
export const StartSprintInput = z.object({ id: Uuid });
export const CompleteSprintInput = z.object({
  id: Uuid,
  carryoverTo: z.union([z.literal("backlog"), Uuid]).default("backlog"),
});
export const AssignCardToSprintInput = z.object({
  cardId: Uuid,
  sprintId: Uuid.nullable(),
});
```

`actions/sprints.ts` (new):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateSprintInput, UpdateSprintInput, DeleteSprintInput,
  StartSprintInput, CompleteSprintInput, AssignCardToSprintInput,
} from "@/lib/validation";

function asDate(v: string | Date | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export async function createSprintImpl(
  token: string,
  input: { workspaceId: string; name: string; goal?: string | null; startDate?: string | Date | null; endDate?: string | Date | null },
) {
  const p = CreateSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(sprints).values({
      workspaceId: p.workspaceId,
      name: p.name,
      goal: p.goal ?? null,
      startDate: asDate(p.startDate) ?? null,
      endDate: asDate(p.endDate) ?? null,
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateSprintImpl(
  token: string,
  input: { id: string; name?: string; goal?: string | null; startDate?: string | Date | null; endDate?: string | Date | null },
) {
  const p = UpdateSprintInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.goal !== undefined) patch.goal = p.goal;
  if (p.startDate !== undefined) patch.startDate = asDate(p.startDate);
  if (p.endDate !== undefined) patch.endDate = asDate(p.endDate);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(sprints).set(patch).where(eq(sprints.id, p.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteSprintImpl(token: string, input: { id: string }) {
  const p = DeleteSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(sprints).where(eq(sprints.id, p.id)).returning({ id: sprints.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function startSprintImpl(token: string, input: { id: string }) {
  const p = StartSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Postgres' partial unique index will reject if another active sprint exists.
    const [row] = await tx.update(sprints)
      .set({ state: "active", startDate: new Date() })
      .where(and(eq(sprints.id, p.id), eq(sprints.state, "planned")))
      .returning();
    if (!row) throw new Error("Cannot start: not planned, or another sprint is already active");
    return row;
  });
}

export async function completeSprintImpl(
  token: string,
  input: { id: string; carryoverTo: "backlog" | string },
) {
  const p = CompleteSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Move incomplete (non-archived) cards to carryover destination.
    if (p.carryoverTo === "backlog") {
      await tx.update(cards)
        .set({ sprintId: null })
        .where(and(eq(cards.sprintId, p.id), eq(cards.archived, false)));
    } else {
      await tx.update(cards)
        .set({ sprintId: p.carryoverTo })
        .where(and(eq(cards.sprintId, p.id), eq(cards.archived, false)));
    }
    const [row] = await tx.update(sprints)
      .set({ state: "completed", completedAt: new Date() })
      .where(and(eq(sprints.id, p.id), eq(sprints.state, "active")))
      .returning();
    if (!row) throw new Error("Cannot complete: sprint is not active");
    return row;
  });
}

export async function assignCardToSprintImpl(
  token: string,
  input: { cardId: string; sprintId: string | null },
) {
  const p = AssignCardToSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(cards).set({ sprintId: p.sprintId })
      .where(eq(cards.id, p.cardId)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

// Wrappers
export async function createSprint(input: Parameters<typeof createSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createSprintImpl(t, input);
  revalidatePath(`/w/${input.workspaceId}/backlog`);
  return r;
}
export async function updateSprint(input: Parameters<typeof updateSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function deleteSprint(input: Parameters<typeof deleteSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteSprintImpl(t, input);
}
export async function startSprint(input: Parameters<typeof startSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await startSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function completeSprint(input: Parameters<typeof completeSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await completeSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function assignCardToSprint(input: Parameters<typeof assignCardToSprintImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await assignCardToSprintImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
```

Commit: `feat(sprints): create/update/delete/start/complete + assign-card actions`

---

## Task 3: Snapshot + realtime

`lib/queries/board-snapshot.ts`:
- `cards` SELECT will pick up `sprintId` automatically via `select()`. Verify `CardRow = typeof cards.$inferSelect` exposes `sprintId`.

`hooks/use-board-realtime.ts`:
- In `rowToCard`, add: `sprintId: r.sprint_id ?? null`.

Commit: `feat(realtime): card.sprintId in row mapper`

---

## Task 4: Sprint queries

`lib/queries/sprints.ts`:

```ts
import { eq, desc, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, boards } from "@/lib/db/schema";

export async function listSprintsForWorkspace(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(sprints).where(eq(sprints.workspaceId, workspaceId))
      .orderBy(desc(sprints.createdAt)),
  );
}

export async function listBacklogCards(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select({
      id: cards.id, title: cards.title, listId: cards.listId,
      boardId: cards.boardId, boardTitle: boards.title,
      sprintId: cards.sprintId, type: cards.type,
      archived: cards.archived,
    })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(
        eq(boards.workspaceId, workspaceId),
        eq(cards.archived, false),
      )),
  );
}
```

(Backlog cards = those with `sprintId = null`. Active/completed sprint cards filter by `sprintId`.)

Commit: `feat(queries): listSprintsForWorkspace + listBacklogCards`

---

## Task 5: Tests

`tests/integration/sprints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  createSprintImpl, startSprintImpl, completeSprintImpl,
  assignCardToSprintImpl, deleteSprintImpl,
} from "@/actions/sprints";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("sprints", () => {
  it("creates and deletes a planned sprint", async () => {
    const u = await makeUser("sp1");
    const { ws } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S1" });
    expect(sp.state).toBe("planned");
    await deleteSprintImpl(u.jwt, { id: sp.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.id, sp.id))
    );
    expect(after.length).toBe(0);
  });

  it("only one active sprint per workspace", async () => {
    const u = await makeUser("sp2");
    const { ws } = await setup(u.jwt);
    const a = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "A" });
    const b = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "B" });
    await startSprintImpl(u.jwt, { id: a.id });
    await expect(startSprintImpl(u.jwt, { id: b.id })).rejects.toThrow();
  });

  it("assigns + unassigns a card to a sprint", async () => {
    const u = await makeUser("sp3");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    let row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect(row[0].sprintId).toBe(sp.id);
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: null });
    row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect(row[0].sprintId).toBeNull();
  });

  it("complete sprint moves remaining cards to backlog by default", async () => {
    const u = await makeUser("sp4");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    await startSprintImpl(u.jwt, { id: sp.id });
    await completeSprintImpl(u.jwt, { id: sp.id, carryoverTo: "backlog" });
    const row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect(row[0].sprintId).toBeNull();
    const sprintRow = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.id, sp.id))
    );
    expect(sprintRow[0].state).toBe("completed");
  });

  it("rejects assigning a card to a sprint in another workspace", async () => {
    const u = await makeUser("sp5");
    const { l } = await setup(u.jwt);
    // Create a separate workspace + sprint
    const otherWs = await createWorkspaceImpl(u.jwt, { name: "Other" });
    const sp = await createSprintImpl(u.jwt, { workspaceId: otherWs.id, name: "Other-S" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await expect(
      assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id }),
    ).rejects.toThrow();
  });
});
```

Run: 5 PASS. Full suite: 53 expected.

Commit: `test(sprints): CRUD + active-uniqueness + cross-workspace guard`

---

## Task 6: SprintPicker (used in card modal + per-card menu)

`components/sprint/sprint-picker.tsx`:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import { assignCardToSprint } from "@/actions/sprints";
import { toast } from "sonner";

export type SprintLite = {
  id: string;
  name: string;
  state: "planned" | "active" | "completed";
};

export function SprintPicker({
  cardId,
  sprintId,
  sprints,
  size = "xs",
}: {
  cardId: string;
  sprintId: string | null;
  sprints: SprintLite[];
  size?: "xs" | "sm";
}) {
  const [pending, start] = useTransition();
  const current = sprints.find((s) => s.id === sprintId);
  const label = current ? current.name : "Backlog";

  function set(next: string | null) {
    if (next === sprintId) return;
    start(async () => {
      try {
        await assignCardToSprint({ cardId, sprintId: next });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] transition-colors"
        disabled={pending}
      >
        <Calendar className="size-3" />
        <span className="truncate max-w-[10rem]">{label.toUpperCase()}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={sprintId ?? "backlog"} onValueChange={(v) => set(v === "backlog" ? null : v)}>
          <DropdownMenuRadioItem value="backlog">Backlog</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {sprints.filter((s) => s.state !== "completed").map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              {s.name} <span className="ml-2 mono-meta-sm text-fg-faint">{s.state.toUpperCase()}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

The card modal needs the `sprints` list. Easiest: fetch in the modal route's server page and pass down.

Commit: `feat(sprints): SprintPicker component`

---

## Task 7: Backlog page

`app/(app)/w/[workspaceId]/backlog/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listSprintsForWorkspace, listBacklogCards } from "@/lib/queries/sprints";
import { CreateSprintDialog } from "@/components/sprint/create-sprint-dialog";
import { SprintCard } from "@/components/sprint/sprint-card";
import { BacklogList } from "@/components/sprint/backlog-list";

export default async function BacklogPage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const allSprints = await listSprintsForWorkspace(token, workspaceId);
  const cards = await listBacklogCards(token, workspaceId);

  const active = allSprints.find((s) => s.state === "active");
  const planned = allSprints.filter((s) => s.state === "planned");
  const completed = allSprints.filter((s) => s.state === "completed");

  const cardsBySprint = new Map<string | null, typeof cards>();
  for (const c of cards) {
    const k = c.sprintId ?? null;
    const arr = cardsBySprint.get(k) ?? [];
    arr.push(c);
    cardsBySprint.set(k, arr);
  }
  const backlogCards = cardsBySprint.get(null) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">{ws.name.toUpperCase()} / BACKLOG</span>
        <h1 className="serif-display text-5xl">
          Sprints &amp; backlog
        </h1>
        <div className="flex justify-between items-center gap-3">
          <Link href={`/w/${workspaceId}`} className="mono-meta-sm text-fg-muted hover:text-fg">
            ← Back to workspace
          </Link>
          <CreateSprintDialog workspaceId={workspaceId} />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">ACTIVE SPRINT</h2>
        {active ? (
          <SprintCard
            sprint={active}
            cards={cardsBySprint.get(active.id) ?? []}
            allSprints={allSprints}
            workspaceId={workspaceId}
          />
        ) : (
          <p className="text-sm text-fg-faint italic">No active sprint. Start one from the planned list.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">PLANNED ({planned.length})</h2>
        <div className="space-y-3">
          {planned.map((s) => (
            <SprintCard
              key={s.id} sprint={s}
              cards={cardsBySprint.get(s.id) ?? []}
              allSprints={allSprints}
              workspaceId={workspaceId}
              activeExists={Boolean(active)}
            />
          ))}
          {planned.length === 0 && (
            <p className="text-sm text-fg-faint italic">No planned sprints.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">BACKLOG ({backlogCards.length})</h2>
        <BacklogList cards={backlogCards} sprints={allSprints} />
      </section>

      {completed.length > 0 && (
        <section className="space-y-3 opacity-70">
          <h2 className="mono-meta text-fg-muted">COMPLETED ({completed.length})</h2>
          <ul className="space-y-1 text-sm">
            {completed.map((s) => (
              <li key={s.id} className="border border-hairline rounded-lg p-3">
                <span className="font-medium">{s.name}</span>
                {s.completedAt && (
                  <span className="ml-2 mono-meta-sm text-fg-faint">
                    {new Date(s.completedAt).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

Commit (with the sub-components): see Task 9 + 10.

---

## Task 8: SprintCard component

`components/sprint/sprint-card.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startSprint, deleteSprint } from "@/actions/sprints";
import { CompleteSprintDialog } from "./complete-sprint-dialog";
import { SprintPicker, type SprintLite } from "./sprint-picker";
import Link from "next/link";
import { Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type SprintCardProps = {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    state: "planned" | "active" | "completed";
    startDate: Date | null;
    endDate: Date | null;
  };
  cards: Array<{
    id: string; title: string; boardId: string; boardTitle: string;
    sprintId: string | null;
  }>;
  allSprints: SprintLite[];
  workspaceId: string;
  activeExists?: boolean;
};

export function SprintCard({ sprint, cards, allSprints, activeExists }: SprintCardProps) {
  const [pending, start] = useTransition();

  function onStart() {
    start(async () => {
      try { await startSprint({ id: sprint.id }); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  function onDelete() {
    if (!confirm("Delete this sprint? Cards in it will move to the backlog.")) return;
    start(async () => {
      try { await deleteSprint({ id: sprint.id }); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  const isActive = sprint.state === "active";

  return (
    <div className={`glass rounded-2xl ${isActive ? "ring-1 ring-fg/40" : ""}`}>
      <header className="flex items-start justify-between gap-3 p-4 border-b border-hairline">
        <div className="space-y-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="serif-display text-2xl text-fg">{sprint.name}</h3>
            <span className="chip">{sprint.state.toUpperCase()}</span>
          </div>
          {sprint.goal && (
            <p className="text-sm text-fg-muted italic">&ldquo;{sprint.goal}&rdquo;</p>
          )}
          {(sprint.startDate || sprint.endDate) && (
            <p className="mono-meta-sm text-fg-faint">
              {sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : "?"}
              {" → "}
              {sprint.endDate ? new Date(sprint.endDate).toLocaleDateString() : "?"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sprint.state === "planned" && (
            <Button size="xs" onClick={onStart} disabled={pending || activeExists}>
              <Play className="size-3 mr-1" /> START
            </Button>
          )}
          {isActive && (
            <CompleteSprintDialog
              sprintId={sprint.id}
              otherSprints={allSprints.filter((s) => s.id !== sprint.id && s.state === "planned")}
            />
          )}
          {sprint.state !== "active" && (
            <Button size="xs" variant="ghost" onClick={onDelete} disabled={pending} aria-label="Delete sprint">
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </header>
      <ul className="divide-y divide-hairline">
        {cards.length === 0 && (
          <li className="px-4 py-6 text-sm text-fg-faint italic text-center">
            No cards yet. Move cards in from the backlog using the sprint dropdown.
          </li>
        )}
        {cards.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2">
            <Link
              href={`/b/${c.boardId}/c/${c.id}`}
              className="flex-1 min-w-0 truncate hover:underline text-sm"
            >
              {c.title}
            </Link>
            <span className="mono-meta-sm text-fg-faint hidden sm:inline">{c.boardTitle}</span>
            <SprintPicker
              cardId={c.id}
              sprintId={c.sprintId ?? null}
              sprints={allSprints}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Task 9: BacklogList + CreateSprintDialog + CompleteSprintDialog

`components/sprint/backlog-list.tsx`:

```tsx
import Link from "next/link";
import { SprintPicker, type SprintLite } from "./sprint-picker";

export function BacklogList({
  cards, sprints,
}: {
  cards: Array<{ id: string; title: string; boardId: string; boardTitle: string; sprintId: string | null }>;
  sprints: SprintLite[];
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-fg-faint italic">Backlog is empty.</p>;
  }
  // Group by board
  const groups = new Map<string, typeof cards>();
  for (const c of cards) {
    const arr = groups.get(c.boardId) ?? [];
    arr.push(c);
    groups.set(c.boardId, arr);
  }
  return (
    <div className="space-y-4">
      {Array.from(groups.values()).map((group) => (
        <div key={group[0].boardId} className="glass rounded-2xl">
          <header className="px-4 py-2 border-b border-hairline mono-meta text-fg">
            {group[0].boardTitle}
          </header>
          <ul className="divide-y divide-hairline">
            {group.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                <Link
                  href={`/b/${c.boardId}/c/${c.id}`}
                  className="flex-1 min-w-0 truncate hover:underline text-sm"
                >
                  {c.title}
                </Link>
                <SprintPicker
                  cardId={c.id}
                  sprintId={c.sprintId ?? null}
                  sprints={sprints}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

`components/sprint/create-sprint-dialog.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { createSprint } from "@/actions/sprints";
import { toast } from "sonner";

export function CreateSprintDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pending, startT] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startT(async () => {
      try {
        await createSprint({
          workspaceId,
          name,
          goal: goal || null,
          startDate: start || null,
          endDate: end || null,
        });
        setOpen(false); setName(""); setGoal(""); setStart(""); setEnd("");
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5 mr-0.5" /> New sprint
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New sprint</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)}
                     required minLength={1} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-goal">Goal (optional)</Label>
              <Input id="sp-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sp-start">Start</Label>
                <Input id="sp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-end">End</Label>
                <Input id="sp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

`components/sprint/complete-sprint-dialog.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { completeSprint } from "@/actions/sprints";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export function CompleteSprintDialog({
  sprintId, otherSprints,
}: {
  sprintId: string;
  otherSprints: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [carryoverTo, setCarryoverTo] = useState<string>("backlog");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await completeSprint({ id: sprintId, carryoverTo });
        setOpen(false);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-3 mr-1" /> COMPLETE
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Complete sprint</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-fg-muted">
              Move the remaining (non-archived) cards to:
            </p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio" name="carry" value="backlog"
                  checked={carryoverTo === "backlog"}
                  onChange={() => setCarryoverTo("backlog")}
                />
                Backlog
              </label>
              {otherSprints.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio" name="carry" value={s.id}
                    checked={carryoverTo === s.id}
                    onChange={() => setCarryoverTo(s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Completing…" : "Complete sprint"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

Commit: `feat(sprints): backlog page + sprint card + dialogs + sprint picker`

---

## Task 10: Wire sprint picker into card modal + Backlog link in nav

Modify `components/board/card-modal.tsx`:
- Fetch `sprints` for the card's workspace inside the page that renders the modal (or pass them down). Given the modal is a client component, plumb sprints from the server route:
  - Update `app/(app)/b/[boardId]/@modal/(.)c/[cardId]/page.tsx` and `app/(app)/b/[boardId]/c/[cardId]/page.tsx` to fetch `listSprintsForWorkspace(token, board.workspaceId)` and pass `sprints` to the modal.
  - Modal renders `<SprintPicker cardId={card.id} sprintId={card.sprintId ?? null} sprints={sprints} />` near the type/parent picker row.

Modify `components/nav/top-nav.tsx`:
- When `activeWorkspaceId` is set, render a small "BACKLOG" link next to the workspace switcher: `<Link href={\`/w/${activeWorkspaceId}/backlog\`}>BACKLOG</Link>`.

Commit: `feat(sprints): card-modal sprint picker + backlog link in nav`

---

## Task 11: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run test:unit` → **53 passing** (48 + 5 new)
- `npx playwright test` → 6 passing
- Manual smoke:
  1. Open workspace → click BACKLOG in nav → page renders.
  2. + New sprint → name "Sprint 1" → create → appears in PLANNED.
  3. Click START → moves to ACTIVE.
  4. From a card on a board → open modal → SprintPicker shows "Backlog" → switch to "Sprint 1" → toast OK → sprint card lists it.
  5. Complete sprint → choose "Backlog" → card returns to backlog → sprint moves to COMPLETED.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Planning-1 (sprints + backlog).
- **Out of scope (deferred):** burndown chart (#12), velocity (#12), drag-cards-into-sprint via dnd-kit (could add later), sprint goals analytics (#16).
- **Hazards:**
  - Partial unique index `sprints_one_active_per_workspace` enforces "one active per workspace" at the DB level. The action `startSprintImpl` filters on `state = 'planned'` so only a planned sprint can be started; if the index would be violated, Postgres throws and the action surfaces "Cannot start: …".
  - `assignCardToSprintImpl` uses RLS — board membership is required (not just workspace membership). If a workspace member ≠ board member (rare in our model since board creator becomes board member, and workspace owner is board admin via RLS), the update silently affects 0 rows and we throw "Forbidden". Acceptable.
  - The backlog page fetches all unarchived cards across all boards in the workspace. For a large workspace this could be slow — pagination is a future concern.
  - `getBoardSnapshot` doesn't fetch sprints (they're workspace-scoped). The modal route fetches them separately. Real-time sprint changes (e.g., admin completes the active sprint while you're on a board) won't reflect in the open modal until reload — acceptable for v1.
