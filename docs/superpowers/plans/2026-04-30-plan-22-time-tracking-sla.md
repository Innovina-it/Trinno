# Plan #22 — Time Tracking + SLA

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Cards carry a time estimate (minutes). Users log work entries against cards, and the card's `spent_min` rolls up via DB trigger. Per-board SLA policies define a target completion time after card creation; a small server-side check (run on demand via cron-ready API endpoint) marks cards as breached and emits a notification.

**Architecture:** Two new tables: `worklogs` (one row per work entry) + `sla_policies` + `card_sla` (per-card SLA state). `cards.estimate_min` and `cards.spent_min` columns; `spent_min` maintained by trigger summing the card's worklogs. SLA breach detection runs on demand via `/api/sla/scan?board_id=...` (POST, board-admin auth) — can be wired to Vercel cron later. Breach inserts a notification using the trigger pattern from plan #23.

**Out of scope:** Calendar integration, automatic timer (start/stop button), per-component SLAs, escalation policies. (All deferrable.)

**Definition of done:**
- Card modal "Time" section: estimate input, "Log work" form (minutes + optional comment + when), worklog history table.
- Tile shows compact `EST 90m / SPENT 45m` chip when either field set.
- Board settings → SLAs tab: add/edit/delete SLA policies (name, target_min, applies_when JSON).
- `/api/sla/scan` endpoint (POST) — caller passes `board_id`; scans cards in that board against active SLA policies; updates `card_sla.breached` rows.
- 5 new integration tests cover: log work + rollup, estimate update, SLA policy CRUD, scan marks breach, RLS denial.
- 74 + 6 tests still pass.

---

## Files

**Migrations:**
- `0027_time_columns.sql` — `cards.estimate_min int`, `cards.spent_min int default 0`.
- `0028_worklogs.sql` — `worklogs` table + trigger maintaining `cards.spent_min`.
- `0029_sla.sql` — `sla_policies`, `card_sla` tables + RLS.

**Schema:** Drizzle additions — `worklogs`, `slaPolicies`, `cardSla`.

**Validation:** `lib/validation.ts` — `LogWorkInput`, `DeleteWorklogInput`, `SetEstimateInput`, `CreateSlaPolicyInput`, `UpdateSlaPolicyInput`, `DeleteSlaPolicyInput`, `ScanSlaInput`.

**Server actions:**
- `actions/worklogs.ts` — `logWork`, `deleteWorklog`.
- `actions/cards.ts` — extend `updateCardImpl` to accept `estimateMin`.
- `actions/sla.ts` — `createSlaPolicy`, `updateSlaPolicy`, `deleteSlaPolicy`, `scanBoardSla` (impl + wrapper).

**Read helpers:**
- `lib/queries/worklogs.ts` — `listWorklogsForCard(token, cardId)`.
- `lib/queries/sla.ts` — `listSlaPoliciesForBoard(token, boardId)`, `listBreachedCards(token, boardId)`.

**Routes:**
- `app/api/sla/scan/route.ts` — POST, takes `{ boardId }`; calls `scanBoardSlaImpl`.

**Components:**
- `components/board/card/time-section.tsx` — modal section.
- `components/board/card/time-chip.tsx` — tile chip.
- `components/board/sla-policies-panel.tsx` — board settings tab.

**Modify:**
- `components/board/card-modal.tsx` — render `<TimeSection cardId={...} />`.
- `components/board/card-tile.tsx` — render `<TimeChip cardId={...} />`.
- `app/(app)/b/[boardId]/settings/page.tsx` — add SLAs section.

**Tests:** `tests/integration/time-sla.test.ts`.

---

## Task 1: Migrations + schema

`supabase/migrations/0027_time_columns.sql`:

```sql
alter table public.cards
  add column estimate_min int check (estimate_min is null or estimate_min >= 0),
  add column spent_min int not null default 0 check (spent_min >= 0);
```

`supabase/migrations/0028_worklogs.sql`:

```sql
create table public.worklogs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  user_id uuid not null references public.profiles(id) on delete restrict,
  minutes int not null check (minutes > 0 and minutes <= 100000),
  started_at timestamptz not null default now(),
  comment text,
  created_at timestamptz not null default now()
);
create index on public.worklogs (card_id, started_at desc);
create index on public.worklogs (board_id);

create or replace function public.set_worklog_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'worklogs: card not found'; end if;
  new.board_id := bid;
  return new;
end$$;

create trigger worklogs_set_board_id
  before insert or update of card_id on public.worklogs
  for each row execute function public.set_worklog_board_id();

-- Maintain cards.spent_min via aggregate after every change.
create or replace function public.recompute_card_spent_min()
returns trigger language plpgsql security definer set search_path = public
as $$
declare cid uuid := coalesce(new.card_id, old.card_id);
begin
  update public.cards
    set spent_min = coalesce(
      (select sum(minutes)::int from public.worklogs where card_id = cid),
      0
    )
    where id = cid;
  return null;
end$$;

create trigger worklogs_aud_recompute
  after insert or update or delete on public.worklogs
  for each row execute function public.recompute_card_spent_min();

alter table public.worklogs enable row level security;

create policy worklogs_select on public.worklogs for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = worklogs.board_id and bm.user_id = auth.uid())
  );
create policy worklogs_self_write on public.worklogs for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = worklogs.card_id and bm.user_id = auth.uid()
    )
  );
create policy worklogs_self_update on public.worklogs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy worklogs_self_delete on public.worklogs for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.worklogs;
```

`supabase/migrations/0029_sla.sql`:

```sql
create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  target_min int not null check (target_min > 0),
  applies_when jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.sla_policies (board_id);

create table public.card_sla (
  card_id uuid not null references public.cards(id) on delete cascade,
  sla_id uuid not null references public.sla_policies(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  started_at timestamptz not null default now(),
  breached_at timestamptz,
  resolved_at timestamptz,
  primary key (card_id, sla_id)
);
create index on public.card_sla (board_id) where breached_at is not null and resolved_at is null;

create or replace function public.set_card_sla_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_sla: card not found'; end if;
  new.board_id := bid;
  return new;
end$$;
create trigger card_sla_set_board_id
  before insert or update of card_id on public.card_sla
  for each row execute function public.set_card_sla_board_id();

alter table public.sla_policies enable row level security;
alter table public.card_sla enable row level security;

create policy sla_policies_select on public.sla_policies for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = sla_policies.board_id and bm.user_id = auth.uid())
  );

-- Only board admins or workspace owners/admins can edit SLAs.
create policy sla_policies_admin_write on public.sla_policies for all
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = sla_policies.board_id
              and bm.user_id = auth.uid() and bm.role = 'admin')
    or exists (select 1 from public.boards b
               join public.workspace_members wm on wm.workspace_id = b.workspace_id
               where b.id = sla_policies.board_id
                 and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.boards b
            join public.workspace_members wm on wm.workspace_id = b.workspace_id
            where b.id = sla_policies.board_id
              and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  );

create policy card_sla_select on public.card_sla for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = card_sla.board_id and bm.user_id = auth.uid())
  );

-- card_sla rows written only by SECURITY DEFINER scan helper. No user policy.

alter publication supabase_realtime add table public.card_sla;
```

Drizzle:
```ts
export const worklogs = pgTable("worklogs", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  boardId: uuid("board_id").notNull(),
  userId: uuid("user_id").notNull(),
  minutes: integer("minutes").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slaPolicies = pgTable("sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  targetMin: integer("target_min").notNull(),
  appliesWhen: jsonb("applies_when").notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardSla = pgTable("card_sla", {
  cardId: uuid("card_id").notNull(),
  slaId: uuid("sla_id").notNull(),
  boardId: uuid("board_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.slaId] }) }));
```

Append `estimateMin: integer("estimate_min")`, `spentMin: integer("spent_min").notNull().default(0)` to `cards` columns.

Apply: `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`. 74 tests still pass.

Commit: `feat(db): time + sla — cards.estimate_min/spent_min, worklogs, sla_policies, card_sla`

---

## Task 2: Validation + actions

`lib/validation.ts`:
```ts
export const SetEstimateInput = z.object({
  id: Uuid,
  estimateMin: z.number().int().nonnegative().nullable(),
});
export const LogWorkInput = z.object({
  cardId: Uuid,
  minutes: z.number().int().positive().max(100000),
  startedAt: z.union([z.string(), z.date()]).optional().nullable(),
  comment: z.string().trim().max(500).nullable().optional(),
});
export const DeleteWorklogInput = z.object({ id: Uuid });
export const CreateSlaPolicyInput = z.object({
  boardId: Uuid,
  name: Title,
  targetMin: z.number().int().positive(),
  appliesWhen: z.record(z.string(), z.unknown()).default({}),
});
export const UpdateSlaPolicyInput = z.object({
  id: Uuid,
  name: Title.optional(),
  targetMin: z.number().int().positive().optional(),
  appliesWhen: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export const DeleteSlaPolicyInput = z.object({ id: Uuid });
export const ScanBoardSlaInput = z.object({ boardId: Uuid });
```

Extend `UpdateCardInput`: add `estimateMin: z.number().int().nonnegative().nullable().optional()`. Extend `updateCardImpl` body:
```ts
if (parsed.estimateMin !== undefined) patch.estimateMin = parsed.estimateMin;
```

`actions/worklogs.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { worklogs } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { LogWorkInput, DeleteWorklogInput } from "@/lib/validation";

function decodeSub(jwt: string) {
  const [, p] = jwt.split(".");
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).sub as string;
}

export async function logWorkImpl(token: string, input: { cardId: string; minutes: number; startedAt?: string | Date | null; comment?: string | null }) {
  const p = LogWorkInput.parse(input);
  const userId = decodeSub(token);
  const startedAt = p.startedAt
    ? (p.startedAt instanceof Date ? p.startedAt : new Date(p.startedAt))
    : new Date();
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(worklogs).values({
      cardId: p.cardId,
      boardId: "00000000-0000-0000-0000-000000000000",
      userId,
      minutes: p.minutes,
      startedAt,
      comment: p.comment ?? null,
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteWorklogImpl(token: string, input: { id: string }) {
  const p = DeleteWorklogInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(worklogs).where(eq(worklogs.id, p.id)).returning({ id: worklogs.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function logWork(input: Parameters<typeof logWorkImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await logWorkImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteWorklog(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteWorklogImpl(t, input);
}
```

`actions/sla.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq, and, isNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { slaPolicies, cardSla, cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateSlaPolicyInput, UpdateSlaPolicyInput, DeleteSlaPolicyInput, ScanBoardSlaInput,
} from "@/lib/validation";

export async function createSlaPolicyImpl(token: string, input: { boardId: string; name: string; targetMin: number; appliesWhen?: Record<string, unknown> }) {
  const p = CreateSlaPolicyInput.parse({ ...input, appliesWhen: input.appliesWhen ?? {} });
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(slaPolicies).values({
      boardId: p.boardId, name: p.name, targetMin: p.targetMin, appliesWhen: p.appliesWhen,
    }).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateSlaPolicyImpl(token: string, input: Parameters<typeof UpdateSlaPolicyInput.parse>[0]) {
  const p = UpdateSlaPolicyInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.targetMin !== undefined) patch.targetMin = p.targetMin;
  if (p.appliesWhen !== undefined) patch.appliesWhen = p.appliesWhen;
  if (p.enabled !== undefined) patch.enabled = p.enabled;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(slaPolicies).set(patch).where(eq(slaPolicies.id, p.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteSlaPolicyImpl(token: string, input: { id: string }) {
  const p = DeleteSlaPolicyInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(slaPolicies).where(eq(slaPolicies.id, p.id)).returning({ id: slaPolicies.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

// Scan: for each enabled policy on board, find non-archived cards where
// (now() - cards.created_at) > target_min and there's no active card_sla row,
// insert one and mark breached_at = now(). For cards now archived, mark
// existing card_sla.resolved_at.
export async function scanBoardSlaImpl(token: string, input: { boardId: string }) {
  const p = ScanBoardSlaInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Resolve already-resolved breaches first
    await tx.execute(sql`
      update public.card_sla cs
        set resolved_at = now()
        where cs.board_id = ${p.boardId}
          and cs.resolved_at is null
          and exists (
            select 1 from public.cards c where c.id = cs.card_id and c.archived = true
          )
    `);

    // Insert breach rows for each policy/card combination that has crossed target.
    await tx.execute(sql`
      insert into public.card_sla (card_id, sla_id, board_id, started_at, breached_at)
      select c.id, p.id, c.board_id, c.created_at, now()
      from public.cards c
      join public.sla_policies p on p.board_id = c.board_id
      where p.board_id = ${p.boardId}
        and p.enabled = true
        and c.archived = false
        and (extract(epoch from now() - c.created_at) / 60) > p.target_min
        and not exists (
          select 1 from public.card_sla cs
            where cs.card_id = c.id and cs.sla_id = p.id
        )
      on conflict (card_id, sla_id) do nothing
    `);

    const breached = await tx.select({
      cardId: cardSla.cardId, slaId: cardSla.slaId, breachedAt: cardSla.breachedAt,
    }).from(cardSla).where(and(
      eq(cardSla.boardId, p.boardId),
      isNull(cardSla.resolvedAt),
    ));

    return { breachedActive: breached.length };
  });
}

// Wrappers
export async function createSlaPolicy(input: Parameters<typeof createSlaPolicyImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createSlaPolicyImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}
export async function updateSlaPolicy(input: Parameters<typeof updateSlaPolicyImpl>[0]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateSlaPolicyImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}
export async function deleteSlaPolicy(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteSlaPolicyImpl(t, input);
}
export async function scanBoardSla(input: { boardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await scanBoardSlaImpl(t, input);
  revalidatePath(`/b/${input.boardId}`);
  revalidatePath(`/b/${input.boardId}/settings`);
  return r;
}
```

Commit: `feat(time+sla): worklog + sla actions`

---

## Task 3: Read helpers

`lib/queries/worklogs.ts`:
```ts
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { worklogs, profiles } from "@/lib/db/schema";

export async function listWorklogsForCard(token: string, cardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select({
      id: worklogs.id, minutes: worklogs.minutes,
      startedAt: worklogs.startedAt, comment: worklogs.comment,
      userId: worklogs.userId, userName: profiles.displayName,
      createdAt: worklogs.createdAt,
    })
      .from(worklogs)
      .leftJoin(profiles, eq(profiles.id, worklogs.userId))
      .where(eq(worklogs.cardId, cardId))
      .orderBy(desc(worklogs.startedAt)),
  );
}
```

`lib/queries/sla.ts`:
```ts
import { eq, and, isNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { slaPolicies, cardSla } from "@/lib/db/schema";

export async function listSlaPoliciesForBoard(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(slaPolicies).where(eq(slaPolicies.boardId, boardId)),
  );
}

export async function listBreachedCards(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(cardSla).where(and(
      eq(cardSla.boardId, boardId),
      isNull(cardSla.resolvedAt),
    )),
  );
}
```

Commit: `feat(queries): worklogs + sla read helpers`

---

## Task 4: API route for SLA scan

`app/api/sla/scan/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { scanBoardSla } from "@/actions/sla";

const Body = z.object({ boardId: z.string().uuid() });

export async function POST(req: Request) {
  const body = Body.parse(await req.json().catch(() => ({})));
  const r = await scanBoardSla({ boardId: body.boardId });
  return NextResponse.json(r);
}
```

Commit: `feat(api): /api/sla/scan endpoint`

---

## Task 5: Tests

`tests/integration/time-sla.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards, slaPolicies, cardSla } from "@/lib/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl, archiveCardImpl } from "@/actions/cards";
import { logWorkImpl, deleteWorklogImpl } from "@/actions/worklogs";
import { createSlaPolicyImpl, scanBoardSlaImpl, deleteSlaPolicyImpl } from "@/actions/sla";

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
  return { b, l };
}

describe("time tracking + sla", () => {
  it("logging work updates cards.spent_min via trigger", async () => {
    const u = await makeUser("tw1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await logWorkImpl(u.jwt, { cardId: c.id, minutes: 30, comment: "design" });
    await logWorkImpl(u.jwt, { cardId: c.id, minutes: 90 });

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect((row as { spentMin: number }).spentMin).toBe(120);
  });

  it("deleting a worklog reduces spent_min", async () => {
    const u = await makeUser("tw2");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    const w = await logWorkImpl(u.jwt, { cardId: c.id, minutes: 60 });
    await deleteWorklogImpl(u.jwt, { id: w.id });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect((row as { spentMin: number }).spentMin).toBe(0);
  });

  it("estimate_min update validates non-negative", async () => {
    const u = await makeUser("tw3");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    const ok = await updateCardImpl(u.jwt, { id: c.id, estimateMin: 240 });
    expect((ok as { estimateMin?: number | null }).estimateMin).toBe(240);
    await expect(updateCardImpl(u.jwt, { id: c.id, estimateMin: -1 })).rejects.toThrow();
  });

  it("scan creates a card_sla breach when threshold passed", async () => {
    const u = await makeUser("tw4");
    const { b, l } = await setup(u.jwt);
    // Create policy with target = 1 minute.
    const sla = await createSlaPolicyImpl(u.jwt, {
      boardId: b.id, name: "Quick triage", targetMin: 1,
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    // Backdate created_at to 2 minutes ago via service role.
    await service.from("cards").update({ created_at: new Date(Date.now() - 2 * 60_000).toISOString() }).eq("id", c.id);

    const r = await scanBoardSlaImpl(u.jwt, { boardId: b.id });
    expect(r.breachedActive).toBe(1);

    const breaches = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardSla).where(eq(cardSla.cardId, c.id))
    );
    expect(breaches.length).toBe(1);
    expect(breaches[0].slaId).toBe(sla.id);
  });

  it("non-admin cannot create SLA policy", async () => {
    const owner = await makeUser("tw5o");
    const other = await makeUser("tw5x");
    const { b } = await setup(owner.jwt);
    await expect(createSlaPolicyImpl(other.jwt, {
      boardId: b.id, name: "Stranger SLA", targetMin: 60,
    })).rejects.toThrow();
  });
});
```

Run: 5 PASS. Full suite: 79 expected.

Commit: `test(time+sla): worklog rollup + estimate validation + sla scan + RLS`

---

## Task 6: TimeSection + TimeChip

`components/board/card/time-section.tsx`:
```tsx
"use client";
import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBoardStore } from "@/stores/board-store";
import { logWork, deleteWorklog } from "@/actions/worklogs";
import { updateCard } from "@/actions/cards";
import { Hourglass, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

type WorklogRow = {
  id: string; minutes: number; comment: string | null;
  startedAt: Date | string;
  userName: string | null;
};

export function TimeSection({
  cardId,
  estimateMin,
  spentMin,
}: {
  cardId: string;
  estimateMin: number | null;
  spentMin: number;
}) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [estimate, setEstimate] = useState<string>(estimateMin?.toString() ?? "");
  const [showLog, setShowLog] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [comment, setComment] = useState("");
  const [worklogs, setWorklogs] = useState<WorklogRow[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch(`/api/worklogs?cardId=${cardId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setWorklogs(d.items ?? []))
      .catch(() => setWorklogs([]));
  }, [cardId, pending]);

  function saveEstimate() {
    const n = estimate.trim() === "" ? null : Number(estimate);
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      toast.error("Non-negative integer.");
      return;
    }
    start(async () => {
      try {
        await updateCard({ id: cardId, estimateMin: n });
        updateCardLocal(cardId, { estimateMin: n } as { estimateMin: number | null });
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function logOne(e: React.FormEvent) {
    e.preventDefault();
    const m = Number(minutes);
    if (!Number.isInteger(m) || m <= 0) { toast.error("Minutes > 0."); return; }
    start(async () => {
      try {
        await logWork({ cardId, minutes: m, comment: comment || null });
        setMinutes(""); setComment(""); setShowLog(false);
        toast.success(`Logged ${m}m`);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function delOne(id: string) {
    start(async () => {
      try { await deleteWorklog({ id }); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-3" data-testid="time-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg flex items-center gap-1">
          <Hourglass className="size-3" /> Time
        </h3>
        <span className="mono-meta-sm text-fg-faint tabular-nums">
          {spentMin}m / {estimateMin == null ? "—" : `${estimateMin}m`}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor={`est-${cardId}`}>Estimate (min)</Label>
          <Input
            id={`est-${cardId}`} type="number" min={0}
            value={estimate} onChange={(e) => setEstimate(e.target.value)}
            placeholder="e.g. 120"
          />
        </div>
        <Button size="sm" onClick={saveEstimate} disabled={pending}>SAVE</Button>
      </div>

      {!showLog ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setShowLog(true)}>
          <Plus className="size-3.5 mr-1" /> Log work
        </Button>
      ) : (
        <form onSubmit={logOne} className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="space-y-1.5 w-32">
              <Label htmlFor={`min-${cardId}`}>Minutes</Label>
              <Input id={`min-${cardId}`} type="number" min={1}
                     value={minutes} onChange={(e) => setMinutes(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5 flex-1">
              <Label htmlFor={`cmt-${cardId}`}>Comment (optional)</Label>
              <Input id={`cmt-${cardId}`} value={comment}
                     onChange={(e) => setComment(e.target.value)} maxLength={500}
                     placeholder="What did you work on?" />
            </div>
            <Button type="submit" size="sm" disabled={pending || !minutes}>LOG</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowLog(false)}>×</Button>
          </div>
        </form>
      )}

      {worklogs.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {worklogs.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="tabular-nums mono-meta-sm w-12">{w.minutes}m</span>
              <span className="flex-1 truncate">
                {w.comment || <span className="text-fg-faint italic">no note</span>}
              </span>
              <span className="mono-meta-sm text-fg-faint">{w.userName ?? "—"}</span>
              <span className="mono-meta-sm text-fg-faint">{new Date(w.startedAt).toLocaleDateString()}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => delOne(w.id)} disabled={pending}>
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`app/api/worklogs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorklogsForCard } from "@/lib/queries/worklogs";

export async function GET(req: Request) {
  await requireUser();
  const token = (await getSessionToken())!;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ items: [] });
  const items = await listWorklogsForCard(token, cardId);
  return NextResponse.json({ items });
}
```

`components/board/card/time-chip.tsx`:
```tsx
"use client";
import { useBoardStore } from "@/stores/board-store";
import { Hourglass } from "lucide-react";

export function TimeChip({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) => s.cards.find((c) => c.id === cardId)) as
    | { estimateMin?: number | null; spentMin?: number | null }
    | undefined;
  const est = card?.estimateMin ?? null;
  const spent = card?.spentMin ?? 0;
  if (est == null && spent === 0) return null;
  const over = est != null && spent > est;
  return (
    <span
      className={`chip inline-flex items-center gap-1 tabular-nums ${over ? "text-fg" : "text-fg-muted"}`}
      title={`Logged ${spent}m${est != null ? ` of ${est}m estimated` : ""}`}
      data-testid="tile-time"
    >
      <Hourglass className="size-3" />
      {spent}/{est ?? "—"}m
    </span>
  );
}
```

Modify `components/board/card-modal.tsx` to render `<TimeSection cardId={card.id} estimateMin={card.estimateMin ?? null} spentMin={card.spentMin ?? 0} />` near other section components.

Modify `components/board/card-tile.tsx` to render `<TimeChip cardId={card.id} />` in the metadata row alongside the type/blocked/story-points chips.

Commit: `feat(card-ui): TimeSection in modal + TimeChip on tile + worklogs API`

---

## Task 7: SLA admin panel + board settings

`components/board/sla-policies-panel.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSlaPolicy, updateSlaPolicy, deleteSlaPolicy, scanBoardSla,
} from "@/actions/sla";
import { toast } from "sonner";
import { Trash2, Plus, RotateCw } from "lucide-react";

type Pol = {
  id: string; name: string; targetMin: number;
  enabled: boolean;
};

export function SlaPoliciesPanel({
  boardId, initial,
}: { boardId: string; initial: Pol[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(target);
    if (!Number.isInteger(t) || t <= 0) { toast.error("target_min > 0"); return; }
    start(async () => {
      try {
        const row = await createSlaPolicy({ boardId, name, targetMin: t, appliesWhen: {} });
        setItems((curr) => [...curr, { id: row.id, name: row.name, targetMin: row.targetMin, enabled: row.enabled }]);
        setName(""); setTarget(""); setAdding(false);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function del(id: string) {
    start(async () => {
      try { await deleteSlaPolicy({ id }); setItems((c) => c.filter((p) => p.id !== id)); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  function toggle(p: Pol) {
    start(async () => {
      try {
        const row = await updateSlaPolicy({ id: p.id, enabled: !p.enabled });
        setItems((c) => c.map((x) => x.id === p.id ? { ...x, enabled: row.enabled } : x));
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function scan() {
    start(async () => {
      try {
        const r = await scanBoardSla({ boardId });
        toast.success(`Scan done. ${r.breachedActive} active breach${r.breachedActive === 1 ? "" : "es"}.`);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">SLA policies</h3>
        <div className="flex gap-2">
          <Button size="xs" variant="outline" onClick={scan} disabled={pending}>
            <RotateCw className="size-3 mr-1" /> SCAN NOW
          </Button>
          {!adding && (
            <Button size="xs" onClick={() => setAdding(true)}>
              <Plus className="size-3 mr-1" /> POLICY
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={add} className="flex items-end gap-2 glass rounded-2xl p-3">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="sla-name">Name</Label>
            <Input id="sla-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="space-y-1.5 w-32">
            <Label htmlFor="sla-target">Target (min)</Label>
            <Input id="sla-target" type="number" min={1} value={target}
                   onChange={(e) => setTarget(e.target.value)} required />
          </div>
          <Button type="submit" size="sm" disabled={pending}>ADD</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>×</Button>
        </form>
      )}

      <ul className="divide-y divide-hairline glass rounded-2xl">
        {items.map((p) => (
          <li key={p.id} className="px-4 py-3 flex items-center gap-3">
            <span className="font-medium flex-1">{p.name}</span>
            <span className="mono-meta-sm text-fg-faint tabular-nums">{p.targetMin}m</span>
            <Button size="xs" variant={p.enabled ? "secondary" : "ghost"} onClick={() => toggle(p)} disabled={pending}>
              {p.enabled ? "ENABLED" : "DISABLED"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => del(p.id)} disabled={pending}>
              <Trash2 className="size-3" />
            </Button>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-4 text-sm text-fg-faint italic">No SLAs yet.</li>}
      </ul>
    </div>
  );
}
```

Modify `app/(app)/b/[boardId]/settings/page.tsx`:
- Fetch `slaPolicies` via `listSlaPoliciesForBoard(token, boardId)`.
- Append a section using `<SlaPoliciesPanel boardId={boardId} initial={slaPolicies.map(p => ({ id: p.id, name: p.name, targetMin: p.targetMin, enabled: p.enabled }))} />`.

Commit: `feat(board): SLA policies panel in board settings`

---

## Task 8: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean (now includes `/api/sla/scan`, `/api/worklogs` routes)
- `npm run test:unit` → **79 passing** (74 + 5)
- `npx playwright test` → 6 passing
- Manual smoke:
  1. Open card → Time section → set estimate 120, log 30m + 90m → tile shows `120/120m`.
  2. Delete a worklog → `30/120m`.
  3. Board settings → SLA → add policy "Triage" 60m → SCAN NOW → toast.
  4. Wait + create card; backdate via DB tool; SCAN NOW → 1 breach.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Time-1 (estimate + worklog) + §Time-2 partial (SLA tracking, no UI breach badge yet — surfaces as toast count from scan; future polish: badge on tile).
- **Out of scope:** Auto-running cron for scan (provision Vercel cron later — POST `/api/sla/scan` with shared secret), SLA breach notification fan-out (could be added: insert into `notifications` for board admins), per-component SLAs.
- **Hazards:**
  - The `recompute_card_spent_min` trigger does an aggregate query per worklog mutation. For a card with 1000 worklogs, each insert recomputes the sum. Acceptable for v1.
  - `card_sla` `started_at` defaults to `now()` when inserted — but the SQL inserts `c.created_at` so the sla age tracks the card's own creation. Re-creating a previously resolved breach starts a new clock.
  - Estimate validation is server-side only (CHECK constraint + zod). UI accepts and surfaces error toast.
  - Worklog history fetched via `/api/worklogs?cardId=...` instead of being plumbed through snapshot — keeps snapshot lean.
