# Gantt Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the roadmap as immutable named baselines (multiple over time) and compare the live Gantt against a chosen baseline to surface schedule variance.

**Architecture:** Four workspace-scoped tables (`roadmap_baselines` + 3 write-once child tables) with RLS (read = any member incl. guest; write = owner/admin). A capture action (`insert … select`), a metadata-only update, delete, and a lazy detail fetch. A pure `compareToBaseline` diff. UI on the roadmap: a Baselines control (save + manager), an opt-in overlay (ghost bars + delta chips), and a variance panel. Default view stays live.

**Tech Stack:** Next.js App Router server actions, Drizzle, Supabase Postgres + RLS, Zustand (`workspace-store`), Vitest (unit), Playwright (e2e), Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-02-gantt-baselines-design.md`

**Project conventions (read before starting):**
- npm (use `npx`/`npm`). Apply migrations with `npx supabase migration up` — NEVER reset. The CLI verb for ad-hoc SQL is `npx supabase db query "…"`.
- Server actions follow `actions/links.ts` (`requireUser → getSessionToken → dbAsUser → assertWorkspaceWriter → mutate → revalidatePath`, wrapped in `actionResult`).
- `actionResult` returns a discriminated union: `{ ok: true, data } | { ok: false, error }` (error is a `StructuredErrorShape` object → `res.error.message`). Branch on `res.ok`.
- RLS uses the SECURITY DEFINER helpers `public.is_workspace_member(_workspace_id, _user_id)` (any membership incl. guest) and `public.is_workspace_admin(_workspace_id, _user_id)` (role in owner/admin) from `0003_rls.sql`. Guard `create type` with a `do $$ … exception when duplicate_object …` block. Add new tables to no publication (baselines are immutable; no realtime).
- Vitest can't transform `@base-ui/react`; components importing `@/components/ui/*` fail unit import-analysis. Keep pure logic (`compareToBaseline`, the cap guard) in unit tests; test dialogs/manager/overlay via Playwright. Put unit tests under `tests/unit/` (vitest only includes `tests/**`).
- The roadmap reads from the **WorkspaceStore** (`useWorkspaceStore`), which already carries `viewerRole`. Reuse it for `canManage = viewerRole === "owner" || "admin"`.
- `assertWorkspaceWriter(role)` already exists at `lib/permissions/workspace-writer.ts` (owner/admin only) — reuse it.
- Latest migration is `0121_links.sql`; next is `0122_roadmap_baselines.sql`.

---

## File Structure

**New files**
- `supabase/migrations/0122_roadmap_baselines.sql`
- `lib/baselines/types.ts` — shared TS types (`BaselineMeta`, `BaselineDetail`, `BaselineEntry`, `Variance`…)
- `lib/baselines/compare.ts` — pure `compareToBaseline`
- `lib/baselines/__tests__`/`tests/unit/baseline-compare.test.ts`
- `actions/roadmap-baselines.ts` — create / update / delete / getDetail
- `components/roadmap/baselines/baseline-menu.tsx` — header control (save + manager dropdown)
- `components/roadmap/baselines/baseline-save-dialog.tsx`
- `components/roadmap/baselines/baseline-rename-dialog.tsx`
- `components/roadmap/baselines/baseline-variance-panel.tsx`
- `tests/e2e/baselines.spec.ts`

**Modified files**
- `lib/db/schema.ts` — 4 tables
- `lib/validation.ts` — Zod inputs
- `stores/workspace-store.ts` — baseline list + detail cache + compare-selection slice
- `lib/queries/workspace-snapshot.ts` — seed baseline list (both return paths)
- `components/roadmap/roadmap-view.tsx` — own compare-mode state, lazy detail load, render menu + banner + panel; pass baseline overlay data to bars
- `components/roadmap/roadmap-header.tsx` — render `BaselineMenu`
- `components/roadmap/roadmap-bar.tsx` — ghost baseline bar + delta chip when in compare mode
- `actions/profile-preferences.ts` (or wherever user_preferences writes live) — persist last-selected baseline + compare on/off (optional, Task 13)

---

## Task 1: Migration

**Files:** Create `supabase/migrations/0122_roadmap_baselines.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 2026-06-02 — Gantt baselines. Immutable named captures of the roadmap's
-- scheduling data for live-vs-baseline comparison. Read = any workspace
-- member incl. guest; write = owner/admin. Captured child tables are
-- write-once (insert at capture, cascade-delete with the parent). No realtime
-- (immutable). Distinct from `versions` (releases) and `milestones`.

create table public.roadmap_baselines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  note         text,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index roadmap_baselines_ws_idx on public.roadmap_baselines (workspace_id, created_at desc);

create table public.roadmap_baseline_entries (
  baseline_id    uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id        uuid not null,
  title          text not null,
  start_date     timestamptz,
  target_date    timestamptz,
  completed_at   timestamptz,
  roadmap_order  integer,
  sprint_id      uuid,
  parent_card_id uuid,
  primary key (baseline_id, card_id)
);

create table public.roadmap_baseline_assignees (
  baseline_id uuid not null references public.roadmap_baselines(id) on delete cascade,
  card_id     uuid not null,
  user_id     uuid not null,
  primary key (baseline_id, card_id, user_id)
);

create table public.roadmap_baseline_milestones (
  baseline_id  uuid not null references public.roadmap_baselines(id) on delete cascade,
  milestone_id uuid not null,
  name         text not null,
  date         timestamptz,
  primary key (baseline_id, milestone_id)
);

-- RLS
alter table public.roadmap_baselines           enable row level security;
alter table public.roadmap_baseline_entries    enable row level security;
alter table public.roadmap_baseline_assignees  enable row level security;
alter table public.roadmap_baseline_milestones enable row level security;

create policy roadmap_baselines_select on public.roadmap_baselines for select
  using (public.is_workspace_member(roadmap_baselines.workspace_id, auth.uid()));
create policy roadmap_baselines_admin_write on public.roadmap_baselines for all
  using (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(roadmap_baselines.workspace_id, auth.uid()));

-- Child tables: visibility follows membership of the parent baseline's workspace;
-- writes (insert at capture, delete via cascade) require admin on the parent.
do $$
declare t text;
begin
  foreach t in array array['roadmap_baseline_entries','roadmap_baseline_assignees','roadmap_baseline_milestones']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select using (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_member(b.workspace_id, auth.uid())));
      create policy %1$s_admin_write on public.%1$s for all using (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_admin(b.workspace_id, auth.uid())))
      with check (
        exists (select 1 from public.roadmap_baselines b
                where b.id = %1$s.baseline_id
                  and public.is_workspace_admin(b.workspace_id, auth.uid())));
    $f$, t);
  end loop;
end$$;
```

- [ ] **Step 2: Apply** — `npx supabase migration up` (NEVER reset). Expected: applies `0122` clean.
- [ ] **Step 3: Verify** —
```bash
npx supabase db query "select polname from pg_policies where tablename like 'roadmap_baseline%' order by 1;"
npx supabase db query "select table_name from information_schema.tables where table_name like 'roadmap_baseline%';"
```
Expect 4 tables and 8 policies (select+write per table).
- [ ] **Step 4: Commit** — `git add supabase/migrations/0122_roadmap_baselines.sql && git commit -m "feat(baselines): tables + RLS for gantt baselines (0122)"`

---

## Task 2: Drizzle schema

**Files:** Modify `lib/db/schema.ts`

- [ ] **Step 1:** After the `links` table, add:
```ts
export const roadmapBaselines = pgTable("roadmap_baselines", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roadmapBaselineEntries = pgTable("roadmap_baseline_entries", {
  baselineId: uuid("baseline_id").notNull(),
  cardId: uuid("card_id").notNull(),
  title: text("title").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  roadmapOrder: integer("roadmap_order"),
  sprintId: uuid("sprint_id"),
  parentCardId: uuid("parent_card_id"),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.cardId] }) }));

export const roadmapBaselineAssignees = pgTable("roadmap_baseline_assignees", {
  baselineId: uuid("baseline_id").notNull(),
  cardId: uuid("card_id").notNull(),
  userId: uuid("user_id").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.cardId, t.userId] }) }));

export const roadmapBaselineMilestones = pgTable("roadmap_baseline_milestones", {
  baselineId: uuid("baseline_id").notNull(),
  milestoneId: uuid("milestone_id").notNull(),
  name: text("name").notNull(),
  date: timestamp("date", { withTimezone: true }),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.milestoneId] }) }));

export type RoadmapBaselineRow = typeof roadmapBaselines.$inferSelect;
```
`pgTable`, `uuid`, `text`, `timestamp`, `integer`, `primaryKey` are already imported (used by `cardMembers`, `cards`).

- [ ] **Step 2:** `npx tsc --noEmit` → no new errors.
- [ ] **Step 3:** `git add lib/db/schema.ts && git commit -m "feat(baselines): drizzle schema"`

---

## Task 3: Validation schemas

**Files:** Modify `lib/validation.ts`

- [ ] **Step 1:** After the link schemas, add:
```ts
export const CreateRoadmapBaselineInput = z.object({
  workspaceId: Uuid,
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).optional().nullable(),
});
export const UpdateRoadmapBaselineInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export const DeleteRoadmapBaselineInput = z.object({ id: Uuid });
export const GetRoadmapBaselineDetailInput = z.object({ id: Uuid });
```
- [ ] **Step 2:** `npx tsc --noEmit` → clean. Commit: `git add lib/validation.ts && git commit -m "feat(baselines): validation schemas"`

---

## Task 4: Shared types + pure compare function (TDD)

**Files:** Create `lib/baselines/types.ts`, `lib/baselines/compare.ts`, `tests/unit/baseline-compare.test.ts`

- [ ] **Step 1: Types** — `lib/baselines/types.ts`:
```ts
export type BaselineMeta = { id: string; workspaceId: string; name: string; note: string | null; createdBy: string; createdAt: string };
export type BaselineEntry = {
  cardId: string; title: string;
  startDate: string | null; targetDate: string | null; completedAt: string | null;
  roadmapOrder: number | null; sprintId: string | null; parentCardId: string | null;
  assignees: string[];           // user ids
};
export type BaselineMilestone = { milestoneId: string; name: string; date: string | null };
export type BaselineDetail = { meta: BaselineMeta; entries: BaselineEntry[]; milestones: BaselineMilestone[] };

// Live side uses the same per-card shape (built from the workspace store).
export type LiveEntry = BaselineEntry;
export type LiveMilestone = BaselineMilestone;

export type CardVariance = {
  cardId: string; title: string;
  status: "slipped" | "pulled_in" | "unchanged" | "added" | "removed" | "completed_since" | "reordered";
  startDeltaDays: number | null;     // live - baseline, null if either side undated
  targetDeltaDays: number | null;
  durationDeltaDays: number | null;
  assigneesAdded: string[]; assigneesRemoved: string[];
};
export type MilestoneVariance = { milestoneId: string; name: string; status: "moved" | "added" | "removed" | "unchanged"; dateDeltaDays: number | null };
export type VarianceResult = {
  cards: CardVariance[];
  milestones: MilestoneVariance[];
  rollup: { slipped: number; pulledIn: number; added: number; removed: number; completedSince: number; worstSlipDays: number };
};
```

- [ ] **Step 2: Failing test** — `tests/unit/baseline-compare.test.ts`. Cover: slip (+days), pull-in (−days), unchanged, added (live-only), removed (baseline-only), completed_since, undated→dated edge (delta null, status reflects scheduling), assignee add/remove, milestone moved/added/removed, and rollup counts. Write concrete cases with fixed ISO dates (e.g. baseline target `2026-06-01`, live `2026-06-20` → `targetDeltaDays: 19`, `status: "slipped"`). Import `compareToBaseline` from `@/lib/baselines/compare`. Run `npx vitest run tests/unit/baseline-compare.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/baselines/compare.ts`:
```ts
import type { BaselineDetail, LiveEntry, LiveMilestone, VarianceResult, CardVariance, MilestoneVariance } from "./types";

const DAY = 86400000;
function dayDelta(live: string | null, base: string | null): number | null {
  if (!live || !base) return null;
  return Math.round((Date.parse(live) - Date.parse(base)) / DAY);
}
function setDiff(a: string[], b: string[]) {
  const bs = new Set(b), as = new Set(a);
  return { added: a.filter((x) => !bs.has(x)), removed: b.filter((x) => !as.has(x)) };
}

export function compareToBaseline(
  live: { entries: LiveEntry[]; milestones: LiveMilestone[] },
  baseline: BaselineDetail,
): VarianceResult {
  const baseById = new Map(baseline.entries.map((e) => [e.cardId, e]));
  const liveById = new Map(live.entries.map((e) => [e.cardId, e]));
  const cards: CardVariance[] = [];

  for (const l of live.entries) {
    const b = baseById.get(l.cardId);
    if (!b) {
      cards.push({ cardId: l.cardId, title: l.title, status: "added", startDeltaDays: null, targetDeltaDays: null, durationDeltaDays: null, assigneesAdded: l.assignees, assigneesRemoved: [] });
      continue;
    }
    const targetDeltaDays = dayDelta(l.targetDate, b.targetDate);
    const startDeltaDays = dayDelta(l.startDate, b.startDate);
    const liveDur = l.startDate && l.targetDate ? (Date.parse(l.targetDate) - Date.parse(l.startDate)) / DAY : null;
    const baseDur = b.startDate && b.targetDate ? (Date.parse(b.targetDate) - Date.parse(b.startDate)) / DAY : null;
    const durationDeltaDays = liveDur != null && baseDur != null ? Math.round(liveDur - baseDur) : null;
    const { added, removed } = setDiff(l.assignees, b.assignees);
    let status: CardVariance["status"] = "unchanged";
    if (!b.completedAt && l.completedAt) status = "completed_since";
    else if (targetDeltaDays != null && targetDeltaDays > 0) status = "slipped";
    else if (targetDeltaDays != null && targetDeltaDays < 0) status = "pulled_in";
    else if ((l.roadmapOrder ?? 0) !== (b.roadmapOrder ?? 0)) status = "reordered";
    cards.push({ cardId: l.cardId, title: l.title, status, startDeltaDays, targetDeltaDays, durationDeltaDays, assigneesAdded: added, assigneesRemoved: removed });
  }
  for (const b of baseline.entries) {
    if (!liveById.has(b.cardId)) cards.push({ cardId: b.cardId, title: b.title, status: "removed", startDeltaDays: null, targetDeltaDays: null, durationDeltaDays: null, assigneesAdded: [], assigneesRemoved: b.assignees });
  }

  const baseMs = new Map(baseline.milestones.map((m) => [m.milestoneId, m]));
  const liveMs = new Map(live.milestones.map((m) => [m.milestoneId, m]));
  const milestones: MilestoneVariance[] = [];
  for (const m of live.milestones) {
    const b = baseMs.get(m.milestoneId);
    if (!b) { milestones.push({ milestoneId: m.milestoneId, name: m.name, status: "added", dateDeltaDays: null }); continue; }
    const d = dayDelta(m.date, b.date);
    milestones.push({ milestoneId: m.milestoneId, name: m.name, status: d ? "moved" : "unchanged", dateDeltaDays: d });
  }
  for (const b of baseline.milestones) if (!liveMs.has(b.milestoneId)) milestones.push({ milestoneId: b.milestoneId, name: b.name, status: "removed", dateDeltaDays: null });

  const rollup = {
    slipped: cards.filter((c) => c.status === "slipped").length,
    pulledIn: cards.filter((c) => c.status === "pulled_in").length,
    added: cards.filter((c) => c.status === "added").length,
    removed: cards.filter((c) => c.status === "removed").length,
    completedSince: cards.filter((c) => c.status === "completed_since").length,
    worstSlipDays: cards.reduce((m, c) => Math.max(m, c.targetDeltaDays ?? 0), 0),
  };
  return { cards, milestones, rollup };
}
```
Adjust to satisfy the test expectations exactly (do not weaken tests). Run → PASS.
- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit: `git add lib/baselines tests/unit/baseline-compare.test.ts && git commit -m "feat(baselines): pure compareToBaseline + types"`

---

## Task 5: Server actions

**Files:** Create `actions/roadmap-baselines.ts`

- [ ] **Step 1:** Implement in the `actions/links.ts` mould. Read `actions/links.ts` + `actions/milestones.ts` for exact import paths (`dbAsUser`, `getSessionToken`/`requireUser`, `actionResult`, `StructuredError`, `decodeSub`). Reuse `assertWorkspaceWriter` from `@/lib/permissions/workspace-writer` and `getWorkspaceRole` from `@/lib/permissions/guest-guard`.

```ts
"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { roadmapBaselines, roadmapBaselineEntries, roadmapBaselineAssignees, roadmapBaselineMilestones, cards, boards, cardMembers, milestones } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { CreateRoadmapBaselineInput, UpdateRoadmapBaselineInput, DeleteRoadmapBaselineInput, GetRoadmapBaselineDetailInput } from "@/lib/validation";
import { StructuredError, actionResult } from "@/lib/errors";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, p] = jwt.split("."); return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).sub;
}
const SOFT_CAP = 25;

export async function createRoadmapBaselineImpl(token: string, input: { workspaceId: string; name: string; note?: string | null }) {
  const p = CreateRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRole(tx, p.workspaceId, actor));
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(roadmapBaselines).where(eq(roadmapBaselines.workspaceId, p.workspaceId));
    if (count >= SOFT_CAP) throw new StructuredError("LIMIT_REACHED", `Baseline limit (${SOFT_CAP}) reached — delete one to continue`, { count });
    const [b] = await tx.insert(roadmapBaselines).values({ workspaceId: p.workspaceId, name: p.name, note: p.note ?? null, createdBy: actor }).returning();
    // entries
    await tx.execute(sql`
      insert into roadmap_baseline_entries (baseline_id, card_id, title, start_date, target_date, completed_at, roadmap_order, sprint_id, parent_card_id)
      select ${b.id}, c.id, c.title, c.start_date, c.target_date, c.completed_at, c.roadmap_order, c.sprint_id, c.parent_card_id
      from cards c join boards bo on bo.id = c.board_id
      where bo.workspace_id = ${p.workspaceId} and c.archived = false`);
    // assignees
    await tx.execute(sql`
      insert into roadmap_baseline_assignees (baseline_id, card_id, user_id)
      select ${b.id}, cm.card_id, cm.user_id from card_members cm
      join cards c on c.id = cm.card_id join boards bo on bo.id = c.board_id
      where bo.workspace_id = ${p.workspaceId} and c.archived = false`);
    // milestones
    await tx.execute(sql`
      insert into roadmap_baseline_milestones (baseline_id, milestone_id, name, date)
      select ${b.id}, m.id, m.name, m.date from milestones m where m.workspace_id = ${p.workspaceId}`);
    return b;
  });
}

export async function updateRoadmapBaselineImpl(token: string, input: { id: string; name?: string; note?: string | null }) {
  const p = UpdateRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select({ workspaceId: roadmapBaselines.workspaceId }).from(roadmapBaselines).where(eq(roadmapBaselines.id, p.id)).limit(1);
    if (!row) throw new StructuredError("NOT_FOUND", "No baseline");
    assertWorkspaceWriter(await getWorkspaceRole(tx, row.workspaceId, actor));
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.note !== undefined) patch.note = p.note;
    if (Object.keys(patch).length) await tx.update(roadmapBaselines).set(patch).where(eq(roadmapBaselines.id, p.id));
    return { id: p.id, workspaceId: row.workspaceId };
  });
}

export async function deleteRoadmapBaselineImpl(token: string, input: { id: string }) {
  const p = DeleteRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select({ workspaceId: roadmapBaselines.workspaceId }).from(roadmapBaselines).where(eq(roadmapBaselines.id, p.id)).limit(1);
    if (!row) throw new StructuredError("NOT_FOUND", "No baseline");
    assertWorkspaceWriter(await getWorkspaceRole(tx, row.workspaceId, actor));
    await tx.delete(roadmapBaselines).where(eq(roadmapBaselines.id, p.id)); // cascades children
    return { workspaceId: row.workspaceId };
  });
}

export async function getRoadmapBaselineDetailImpl(token: string, input: { id: string }) {
  const p = GetRoadmapBaselineDetailInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [meta] = await tx.select().from(roadmapBaselines).where(eq(roadmapBaselines.id, p.id)).limit(1);
    if (!meta) throw new StructuredError("NOT_FOUND", "No baseline");
    const entries = await tx.select().from(roadmapBaselineEntries).where(eq(roadmapBaselineEntries.baselineId, p.id));
    const asg = await tx.select().from(roadmapBaselineAssignees).where(eq(roadmapBaselineAssignees.baselineId, p.id));
    const ms = await tx.select().from(roadmapBaselineMilestones).where(eq(roadmapBaselineMilestones.baselineId, p.id));
    return { meta, entries, assignees: asg, milestones: ms };
  });
}

// Wrappers (actionResult; branch on res.ok at call sites)
export async function createRoadmapBaseline(input: { workspaceId: string; name: string; note?: string | null }) {
  return actionResult(async () => { await requireUser(); const t = (await getSessionToken())!; const r = await createRoadmapBaselineImpl(t, input); revalidatePath(`/w/${input.workspaceId}/roadmap`); return r; });
}
export async function updateRoadmapBaseline(input: { id: string; name?: string; note?: string | null }) {
  return actionResult(async () => { await requireUser(); const t = (await getSessionToken())!; const r = await updateRoadmapBaselineImpl(t, input); revalidatePath(`/w/${r.workspaceId}/roadmap`); return r; });
}
export async function deleteRoadmapBaseline(input: { id: string }) {
  return actionResult(async () => { await requireUser(); const t = (await getSessionToken())!; const r = await deleteRoadmapBaselineImpl(t, input); revalidatePath(`/w/${r.workspaceId}/roadmap`); return r; });
}
export async function getRoadmapBaselineDetail(input: { id: string }) {
  return actionResult(async () => { await requireUser(); const t = (await getSessionToken())!; return getRoadmapBaselineDetailImpl(t, input); });
}
```
Verify import paths against `actions/links.ts`. Confirm `tx.execute(sql\`…\`)` is the project's raw-SQL idiom (see `lib/queries/workspace-snapshot.ts` which uses `tx.execute`/`sql`); if Drizzle prefers `db.execute`, match it.

- [ ] **Step 2:** Smoke-test the capture SQL against the live DB with `npx supabase db query` using a real workspace id (insert a baseline, confirm entries/assignees/milestones rows appear, then delete it). Do NOT reset.
- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit: `git add actions/roadmap-baselines.ts && git commit -m "feat(baselines): server actions (create/update/delete/detail)"`

---

## Task 6: WorkspaceStore — baseline list + detail cache + compare selection

**Files:** Modify `stores/workspace-store.ts`

- [ ] **Step 1:** Read the store (it already has `viewerRole`, `cardLinkByCard`, `setSnapshot`, `mergeSnapshotPreservingRealtime`). Add, mirroring those patterns:
```ts
import type { BaselineMeta, BaselineDetail } from "@/lib/baselines/types";
// state:
baselines: BaselineMeta[];                       // seeded from snapshot
baselineDetailById: Record<string, BaselineDetail>; // lazy cache
compareBaselineId: string | null;               // null = live (default)
setBaselines: (b: BaselineMeta[]) => void;
cacheBaselineDetail: (d: BaselineDetail) => void;
setCompareBaselineId: (id: string | null) => void;
```
Seed `baselines: initial.baselines ?? []`, `baselineDetailById: {}`, `compareBaselineId: null`. Add the three setters (`set((s)=>…)`). Make `baselines` flow through `setSnapshot` (spread) and `mergeSnapshotPreservingRealtime` (`s.baselines ?? state.baselines`) like `cardLinkByCard`. `compareBaselineId`/`baselineDetailById` are pure client UI state — never seeded from snapshot, preserved across merges. Add `baselines?` to the init/snapshot type.
- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx vitest run tests/unit tests/shared-cache` → still the pre-existing 6 failures, no new. Commit: `git add stores/workspace-store.ts && git commit -m "feat(baselines): workspace-store baseline slice"`

---

## Task 7: SSR seed baseline list

**Files:** Modify `lib/queries/workspace-snapshot.ts`

- [ ] **Step 1:** This file has TWO return paths (empty-boards short-circuit ~line 230, main ~line 428) — both already set `cardLinkByCard`. Add a `baselines` query (metadata only) and include it in BOTH returns + the `WorkspaceSnapshot` type (optional field `baselines?: BaselineMeta[]`):
```ts
const baselineRows = await tx.select().from(roadmapBaselines)
  .where(eq(roadmapBaselines.workspaceId, workspaceId))
  .orderBy(desc(roadmapBaselines.createdAt));
const baselines: BaselineMeta[] = baselineRows.map((b) => ({
  id: b.id, workspaceId: b.workspaceId, name: b.name, note: b.note,
  createdBy: b.createdBy, createdAt: b.createdAt.toISOString(),
}));
```
Import `roadmapBaselines` from schema, `desc` from drizzle, `BaselineMeta` from `@/lib/baselines/types`. In the empty short-circuit path, `baselines: []` is fine (no workspace cards yet, but baselines could exist — safer to run the query there too; do so).
- [ ] **Step 2:** `npx tsc --noEmit` clean; unit + shared-cache unchanged (the field is optional → fixtures untouched). Commit: `git add lib/queries/workspace-snapshot.ts && git commit -m "feat(baselines): seed baseline list into workspace snapshot"`

---

## Task 8: Baseline menu + save dialog (header)

**Files:** Create `components/roadmap/baselines/baseline-menu.tsx`, `components/roadmap/baselines/baseline-save-dialog.tsx`; modify `components/roadmap/roadmap-header.tsx` + `components/roadmap/roadmap-view.tsx`

- [ ] **Step 1:** `baseline-save-dialog.tsx` — a small dialog (name + note) reusing `@/components/ui/dialog` + `@/components/ui/button` + `@/components/ui/input` (confirm exports as in the link `LinkEditDialog`). `onSave({name, note})` calls `createRoadmapBaseline` and branches on `res.ok` (toast on error, incl. the `LIMIT_REACHED` message). `data-testid="baseline-save-dialog"`, inputs `baseline-name-input` / `baseline-note-input`, submit `baseline-save-submit`.
- [ ] **Step 2:** `baseline-menu.tsx` — a `DropdownMenu` (match `workspace-switcher.tsx` usage) labeled "Baselines" (`data-testid="baseline-menu"`). Reads from `useWorkspaceStore`: `baselines`, `viewerRole`, `compareBaselineId`, setters. `canManage = viewerRole === "owner" || "admin"`. Contents:
  - if `canManage`: "Save baseline…" (opens save dialog).
  - list each baseline (name · date) with **Compare** (calls `onCompare(id)` — wired in Task 10), and if `canManage` **Rename** + **Delete** (Task 9). `data-testid="baseline-row-<id>"`.
  - if comparing (`compareBaselineId`): a "Stop comparing" item (`setCompareBaselineId(null)`).
  - empty state when `baselines.length === 0`.
- [ ] **Step 3:** Render `<BaselineMenu onCompare={…} />` in `roadmap-header.tsx` among the left-zone controls (add a prop to RoadmapHeader and pass an `onCompare` handler from `roadmap-view.tsx`). Keep additive.
- [ ] **Step 4:** `npx tsc --noEmit` clean; unit count unchanged. Commit the 4 files (explicit `git add`, NOT `-A`): `… && git commit -m "feat(baselines): header menu + save dialog"`

---

## Task 9: Rename + delete

**Files:** Create `components/roadmap/baselines/baseline-rename-dialog.tsx`; wire into `baseline-menu.tsx`

- [ ] **Step 1:** `baseline-rename-dialog.tsx` — name+note dialog (prefilled), `onSave` → `updateRoadmapBaseline({id,name,note})`, `res.ok` branch. `data-testid="baseline-rename-dialog"`.
- [ ] **Step 2:** In `baseline-menu.tsx`, wire **Rename** (opens rename dialog for that row) and **Delete** (calls `deleteRoadmapBaseline({id})`, `res.ok` branch + toast; if the deleted id was `compareBaselineId`, call `setCompareBaselineId(null)`). Both visible only when `canManage`.
- [ ] **Step 3:** tsc clean; unit unchanged. Commit (explicit add): `… "feat(baselines): rename + delete baselines"`

---

## Task 10: Compare mode — lazy detail load + banner + live-set builder

**Files:** Modify `components/roadmap/roadmap-view.tsx`

- [ ] **Step 1:** Add compare state driven by the store's `compareBaselineId`. `onCompare(id)`:
  - `setCompareBaselineId(id)`; if `!baselineDetailById[id]`, call `getRoadmapBaselineDetail({id})`, and on `res.ok` `cacheBaselineDetail(buildDetail(res.data))` (map server rows → `BaselineDetail`: fold assignees into entries by cardId; ISO-string the dates).
- [ ] **Step 2:** Build the **live** comparable set from the store's cards/cardMembers/milestones the roadmap already reads (project to `LiveEntry[]`/`LiveMilestone[]`: cardId, title, dates (ISO), completedAt, roadmapOrder, sprintId, parentCardId, assignees[]). Compute `const variance = compareBaselineId && detail ? compareToBaseline({entries: liveEntries, milestones: liveMs}, detail) : null;` (memoized).
- [ ] **Step 3:** When `compareBaselineId` is set, render a **compare banner** above the grid (`data-testid="baseline-compare-banner"`): "Comparing against: <name> · <rollup summary> · Stop". Build a `Map<cardId, CardVariance>` and pass the relevant per-card variance + the baseline entry (for ghost geometry) down to each `RoadmapBar` (Task 11). Pass `null` when not comparing (default live view — unchanged behavior).
- [ ] **Step 4:** tsc clean; unit unchanged. Commit `roadmap-view.tsx`: `… "feat(baselines): compare mode state + lazy detail + banner"`

---

## Task 11: Ghost baseline bars + delta chips

**Files:** Modify `components/roadmap/roadmap-bar.tsx`

- [ ] **Step 1:** Accept new optional props: `baselineEntry?: { startDate: string|null; targetDate: string|null } | null` and `variance?: CardVariance | null`. When present and the dates exist, compute a second `(x, width)` from the baseline dates using the SAME date→pixel projection the bar already uses for the live bar, and render a **dimmed ghost outline bar behind** the live bar (e.g. `border border-dashed opacity-40`, no fill). When `variance.targetDeltaDays` is non-zero, render a small chip near the bar end: `+Nd` (red, slipped) / `−Nd` (green, pulled-in). For `status: "removed"` render only the ghost (dashed) and a "removed" tag; for `"added"` tag the live bar "new". Keep ALL existing behavior when `baselineEntry`/`variance` are null (default).
- [ ] **Step 2:** tsc clean; unit count unchanged (note: `tests/unit` reads some roadmap source — keep additive so the 6 baseline stays). Commit: `… "feat(baselines): ghost baseline bars + delta chips on gantt"`

---

## Task 12: Variance panel

**Files:** Create `components/roadmap/baselines/baseline-variance-panel.tsx`; render from `roadmap-view.tsx`

- [ ] **Step 1:** A side panel (`data-testid="baseline-variance-panel"`) shown when comparing. Props: the `VarianceResult`. Sections grouped Slipped / Pulled-in / Added / Removed / Completed / Milestone-moved, each row showing title + day-delta; rollup summary header. Resolve assignee user-ids to names via the workspace store's `workspaceProfiles` if showing assignee changes. Close button → `setCompareBaselineId(null)`.
- [ ] **Step 2:** Render it from `roadmap-view.tsx` when `variance` is non-null (a toggle from the banner — e.g. "Details" opens the panel). tsc clean; unit unchanged. Commit the 2 files: `… "feat(baselines): variance panel"`

---

## Task 13: Persist last-selected baseline (optional polish)

**Files:** Modify the user-preferences write path (`actions/profile-preferences.ts` + the roadmap pref read)

- [ ] **Step 1:** Persist `{ compareBaselineId }` under the workspace-page nesting in `user_preferences` JSONB (follow the existing roadmap/backlog pref pattern — read the current shape first). On roadmap mount, hydrate `compareBaselineId` from prefs (but the GLOBAL default remains live: only restore if the user previously opted in). Debounce writes like existing prefs.
- [ ] **Step 2:** tsc clean; unit unchanged. Commit: `… "feat(baselines): remember last compared baseline per user"`

---

## Task 14: End-to-end tests

**Files:** Create `tests/e2e/baselines.spec.ts`

- [ ] **Step 1:** Reuse the auth/seed helpers from existing specs (sign up `@innovina.it`, `tr_seed_demo` cookie + `/signup`, as in `invitations.spec.ts`/`links.spec.ts`). Scenarios (use the `data-testid`s above):
  1. Owner saves a baseline → it appears in `baseline-menu`.
  2. Move a card's target date later → **Compare** → `baseline-compare-banner` visible, the card shows a `+Nd` slip chip / ghost bar, and the variance panel lists it under "Slipped".
  3. Member (non-admin) can **Compare** but sees NO "Save/Rename/Delete" controls.
  4. Guest can compare read-only.
  5. Rename a baseline → name updates; delete → it disappears and compare exits.
  6. Soft cap: skipped/documented (creating 25 is impractical in e2e) — instead unit-test the cap guard if feasible, or assert the LIMIT_REACHED toast path is wired.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/baselines.spec.ts` (the harness self-starts `npm run dev`; needs local Supabase). If the environment can't run here, report what's needed; don't claim green without running. Commit the spec.

---

## Final verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run tests/unit tests/shared-cache` → baseline-compare passes; only the pre-existing 6 unrelated failures remain.
- [ ] `npx playwright test tests/e2e/baselines.spec.ts` green (if runnable).
- [ ] Manual: owner saves baseline, shifts dates, compares (ghost bars + chips + panel); member/guest read-only; default view is live.

## Self-review checklist (run after authoring)
- Spec coverage: capture (T1,T5), compare (T4,T10,T12), overlay (T11), manager+save+rename+delete (T8,T9), permissions (RLS T1 + guard T5 + UI gating T8/T9), default-live + explicit compare (T10), seed (T7), persistence (T13), tests (T4 unit, T14 e2e). ✅
- Naming: `roadmap_baselines*` / `roadmapBaseline*` distinct from `versions`, `milestones`, `cardLinks`. ✅
- Immutability: only `updateRoadmapBaseline` writes, and only to `name`/`note`; no action touches the three child tables after capture. ✅
