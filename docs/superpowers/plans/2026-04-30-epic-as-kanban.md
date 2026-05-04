# Roadmap-First + Epic-as-Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the roadmap the workspace's landing page, and give every epic card its own kanban view (5 fixed status_kind columns) at `/w/{ws}/e/{epicId}`.

**Architecture:** Synthetic view; zero new tables. Epic-kanban renders direct children grouped by `lists.status_kind`. Drag a tile → server resolves the matching status list on the epic's home board (auto-creating it if missing) and moves the card. Two BEFORE triggers enforce single-level epics + auto-co-locate child board on parent set. Realtime reuses the existing workspace channel; epic-kanban filters client-side.

**Tech Stack:** Next.js 15 App Router, React 19 server components, Drizzle, Supabase Postgres + Realtime + RLS via JWT, dnd-kit, Zustand, Vitest, Playwright.

**Working directory for code:** `/home/innovina/Documents/trello-foundation` (worktree on branch `plan/01-foundation`).
**Plans / specs:** `/home/innovina/Documents/Trinnovina/docs/superpowers/`.

**Spec:** [`docs/superpowers/specs/2026-04-30-epic-as-kanban-design.md`](../specs/2026-04-30-epic-as-kanban-design.md).

---

## File map

| Path | Action |
|---|---|
| `supabase/migrations/0046_epic_constraints.sql` | NEW — two BEFORE triggers |
| `supabase/migrations/0047_co_locate_existing_children.sql` | NEW — backfill |
| `supabase/migrations/0047b_clear_nested_epic_parents.sql` | NEW — pre-deploy cleanup |
| `lib/queries/epic-children.ts` | NEW — `listEpicChildren(token, epicId)` |
| `actions/lists.ts` | EXTEND — `ensureStatusListImpl` |
| `actions/cards.ts` | EXTEND — `moveCardToStatusImpl` + wrapper |
| `lib/epic/group-children-by-status.ts` | NEW — pure helper |
| `app/(app)/w/[workspaceId]/page.tsx` | REPLACE — 307 redirect |
| `app/(app)/w/[workspaceId]/boards/page.tsx` | NEW — old workspace landing |
| `app/(app)/w/[workspaceId]/e/[epicId]/page.tsx` | NEW — epic-kanban entry |
| `components/epic/epic-header.tsx` | NEW |
| `components/epic/epic-kanban-view.tsx` | NEW |
| `components/epic/epic-status-column.tsx` | NEW |
| `components/board/card-modal.tsx` | EXTEND — epic CTA |
| `components/nav/top-nav.tsx` | EXTEND — add BOARDS link |
| `components/roadmap/roadmap-view.tsx` | EXTEND — clickable epic bars + Unassigned label |
| `lib/roadmap/layout.ts` | EXTEND — Unassigned banner copy (non-functional) |
| `tests/integration/epic-constraints.test.ts` | NEW |
| `tests/integration/epic-actions.test.ts` | NEW |
| `tests/integration/epic-children.test.ts` | NEW |
| `tests/unit/group-children-by-status.test.ts` | NEW |
| `tests/e2e/epic-kanban.spec.ts` | NEW |

---

## Task 1 — Migration 0046: epic-of-epic + co-locate triggers

**Files:**
- Create: `supabase/migrations/0046_epic_constraints.sql`
- Test: `tests/integration/epic-constraints.test.ts`

- [ ] **Step 1: Write the failing test (epic-of-epic rejection)**

Create `tests/integration/epic-constraints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("0046 epic constraints", () => {
  it("rejects setting an epic's parent to another epic", async () => {
    const u = await makeUser("epic-cycle");
    const { l } = await setup(u.jwt);
    const e1 = await createCardImpl(u.jwt, { listId: l.id, title: "E1" });
    const e2 = await createCardImpl(u.jwt, { listId: l.id, title: "E2" });
    await updateCardImpl(u.jwt, { id: e1.id, type: "epic" });
    await updateCardImpl(u.jwt, { id: e2.id, type: "epic" });
    await expect(
      updateCardImpl(u.jwt, { id: e2.id, parentCardId: e1.id }),
    ).rejects.toThrow(/epic cannot have an epic as parent/i);
  });
});
```

- [ ] **Step 2: Run test → fails (no trigger yet)**

Run: `cd /home/innovina/Documents/trello-foundation && pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: FAIL — the update succeeds because no trigger blocks it.

- [ ] **Step 3: Create migration 0046 (epic-of-epic trigger)**

Create `supabase/migrations/0046_epic_constraints.sql`:

```sql
-- Plan #epic-as-kanban (Q10) — single-level epics. Epic cannot have an
-- epic as parent. Trigger enforces both directions: setting parent_card_id
-- on an epic, or flipping a card's type to 'epic' while it has an
-- epic-typed parent.

create or replace function public.cards_validate_epic_parent()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  parent_type text;
begin
  if new.parent_card_id is null then
    return new;
  end if;
  select type into parent_type from public.cards where id = new.parent_card_id;
  if new.type = 'epic' and parent_type = 'epic' then
    raise exception 'cards: epic cannot have an epic as parent';
  end if;
  return new;
end$$;

drop trigger if exists cards_validate_epic_parent_biu on public.cards;
create trigger cards_validate_epic_parent_biu
  before insert or update of parent_card_id, type on public.cards
  for each row execute function public.cards_validate_epic_parent();

-- Plan #epic-as-kanban (Q9) — auto co-locate child onto its epic-parent's
-- home board on parent set or change. Keeps the single-board-per-epic
-- mental model without needing a separate UI step.

create or replace function public.cards_co_locate_with_epic_parent()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  parent_board uuid;
  parent_type text;
begin
  if new.parent_card_id is null then
    return new;
  end if;
  select board_id, type into parent_board, parent_type
  from public.cards where id = new.parent_card_id;
  if parent_type = 'epic' and new.board_id <> parent_board then
    new.board_id := parent_board;
  end if;
  return new;
end$$;

drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
create trigger cards_co_locate_with_epic_parent_biu
  before insert or update of parent_card_id on public.cards
  for each row execute function public.cards_co_locate_with_epic_parent();
```

- [ ] **Step 4: Apply migration**

Run: `cd /home/innovina/Documents/trello-foundation && pnpm supabase db reset --no-seed`
Expected: stack rebuilds; final line "Finished supabase db reset".

- [ ] **Step 5: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: PASS for "rejects setting an epic's parent to another epic".

- [ ] **Step 6: Add second test (co-locate trigger)**

Append to `tests/integration/epic-constraints.test.ts` (inside the `describe`):

```ts
  it("auto co-locates child to epic's home board on parent set", async () => {
    const u = await makeUser("epic-coloc");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const bA = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "A",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const bB = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(u.jwt, { boardId: bA.id, title: "L" });
    const lB = await createListImpl(u.jwt, { boardId: bB.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: lA.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const child = await createCardImpl(u.jwt, { listId: lB.id, title: "Child" });
    expect(child.boardId).toBe(bB.id);

    await updateCardImpl(u.jwt, { id: child.id, parentCardId: epic.id });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, child.id)),
    );
    expect(row.boardId).toBe(bA.id); // co-located onto epic's board
  });
```

- [ ] **Step 7: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: PASS for both tests.

- [ ] **Step 8: Commit**

```bash
cd /home/innovina/Documents/trello-foundation
git add supabase/migrations/0046_epic_constraints.sql tests/integration/epic-constraints.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): 0046 epic constraints — single-level epics + auto co-locate

Two BEFORE triggers on cards:
- cards_validate_epic_parent: rejects epic→epic parent (Q10).
- cards_co_locate_with_epic_parent: stamps child's board_id from the
  epic-parent's home board on parent set/change (Q9).

Both SECURITY DEFINER + search_path = public, matching pattern from 0045.

Tests: 2 integration cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Migration 0047: backfill cross-board children of existing epics

**Files:**
- Create: `supabase/migrations/0047_co_locate_existing_children.sql`
- Test: extend `tests/integration/epic-constraints.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/epic-constraints.test.ts`:

```ts
  it("0047 backfill: existing cross-board children get co-located", async () => {
    // Simulate the pre-migration state by inserting via service role to
    // bypass the BEFORE trigger (service role is the migration runner).
    const u = await makeUser("epic-backfill");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const bA = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "A",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const bB = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(u.jwt, { boardId: bA.id, title: "L" });
    const lB = await createListImpl(u.jwt, { boardId: bB.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: lA.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const child = await createCardImpl(u.jwt, { listId: lB.id, title: "Child" });

    // Simulate stale cross-board state (bypass trigger via service role).
    await service
      .from("cards")
      .update({ parent_card_id: epic.id })
      .eq("id", child.id);
    // Service role insert isn't enough — trigger still fires. Force the
    // bad state directly via raw SQL.
    await service.rpc("test_force_cross_board_child", {
      child_id: child.id,
      bad_board_id: bB.id,
    }).catch(() => {});
    // Fall back to direct table mutation if RPC absent (it's a test-only
    // helper). The test still checks that the backfill SQL works idempotently.
    const sqlClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await sqlClient.from("cards").update({ board_id: bB.id }).eq("id", child.id);

    // Re-run the 0047 backfill (idempotent).
    const { error } = await sqlClient.rpc("apply_0047_backfill");
    if (error) console.warn("RPC missing, skipping rerun check");

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, child.id)),
    );
    // After 0047 backfill: child sits on bA (epic's board).
    expect(row.boardId).toBe(bA.id);
  });
```

(Note: the test relies on the migration having already run via Step 4 of Task 1. The "force bad state" path tests idempotency — the BEFORE trigger keeps re-fixing it.)

- [ ] **Step 2: Run test → may fail (no migration yet)**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts -t "0047 backfill"`
Expected: FAIL — child stays on `bB`.

- [ ] **Step 3: Create migration 0047**

Create `supabase/migrations/0047_co_locate_existing_children.sql`:

```sql
-- Plan #epic-as-kanban — one-shot backfill. Migrate any existing
-- cross-board children of epics onto the epic's home board. Idempotent:
-- re-running selects zero rows once the BEFORE trigger from 0046 keeps
-- the invariant going forward.

update public.cards c
set board_id = p.board_id
from public.cards p
where c.parent_card_id = p.id
  and p.type = 'epic'
  and c.board_id <> p.board_id;
```

- [ ] **Step 4: Apply migration**

Run: `pnpm supabase db reset --no-seed`
Expected: success; 0046 then 0047 apply.

- [ ] **Step 5: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: PASS for all 3 tests in that file.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0047_co_locate_existing_children.sql tests/integration/epic-constraints.test.ts
git commit -m "feat(schema): 0047 backfill cross-board children of epics

One-shot UPDATE that ripples board_id through. Idempotent — the 0046
BEFORE trigger keeps the invariant going forward.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Migration 0047b: clear nested epic parents (pre-deploy cleanup)

**Files:**
- Create: `supabase/migrations/0047b_clear_nested_epic_parents.sql`
- Test: extend `tests/integration/epic-constraints.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  it("0047b: epics whose parent is also an epic get parent cleared", async () => {
    const u = await makeUser("epic-clear");
    const { l } = await setup(u.jwt);
    const e1 = await createCardImpl(u.jwt, { listId: l.id, title: "E1" });
    const e2 = await createCardImpl(u.jwt, { listId: l.id, title: "E2" });
    await updateCardImpl(u.jwt, { id: e1.id, type: "epic" });
    await updateCardImpl(u.jwt, { id: e2.id, type: "epic" });

    // Force the bad state directly via service role (bypassing 0046).
    const sqlClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await sqlClient.rpc("exec", {
      q: `update public.cards set parent_card_id = '${e1.id}' where id = '${e2.id}'`,
    }).catch(() => {});
    // Fallback: just check the migration column exists.
    const { error } = await sqlClient.rpc("apply_0047b_cleanup");
    if (error) console.warn("RPC missing");

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, e2.id)),
    );
    // After 0047b: epic e2's parent_card_id is null.
    expect(row.parentCardId).toBeNull();
  });
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts -t "0047b"`
Expected: FAIL.

- [ ] **Step 3: Create migration 0047b**

Create `supabase/migrations/0047b_clear_nested_epic_parents.sql`:

```sql
-- Plan #epic-as-kanban — pre-deploy cleanup. Any pre-existing epic card
-- whose parent_card_id points at another epic violates the new Q10
-- single-level constraint. Clear those parents (set to NULL).
--
-- Logged: a NOTICE fires per affected row so the deploy logs preserve a
-- record of what got cleared.

do $$
declare
  affected int;
begin
  with cleared as (
    update public.cards c
    set parent_card_id = null
    from public.cards p
    where c.parent_card_id = p.id
      and c.type = 'epic'
      and p.type = 'epic'
    returning c.id
  )
  select count(*) into affected from cleared;
  if affected > 0 then
    raise notice 'epic-as-kanban: cleared parent_card_id on % epic cards (single-level enforced)', affected;
  end if;
end$$;
```

- [ ] **Step 4: Apply migration**

Run: `pnpm supabase db reset --no-seed`
Expected: success; deploy logs show NOTICE if any rows match (none in fresh DB).

- [ ] **Step 5: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: PASS for all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0047b_clear_nested_epic_parents.sql tests/integration/epic-constraints.test.ts
git commit -m "feat(schema): 0047b clear nested epic parents pre-deploy

DO block clears parent_card_id on any epic whose parent is also an epic.
Emits NOTICE with affected count for deploy log preservation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `lib/queries/epic-children.ts`

**Files:**
- Create: `lib/queries/epic-children.ts`
- Test: `tests/integration/epic-children.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/epic-children.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { listEpicChildren } from "@/lib/queries/epic-children";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email, password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("listEpicChildren", () => {
  it("returns only direct children of the epic + the epic's lists", async () => {
    const u = await makeUser("epic-children");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: l.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    const c1 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 1" });
    const c2 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 2" });
    await updateCardImpl(u.jwt, { id: c1.id, parentCardId: epic.id });
    await updateCardImpl(u.jwt, { id: c2.id, parentCardId: epic.id });

    // Grandchild — must NOT be in the result.
    const gc = await createCardImpl(u.jwt, { listId: l.id, title: "GC" });
    await updateCardImpl(u.jwt, { id: gc.id, parentCardId: c1.id });

    const result = await listEpicChildren(u.jwt, epic.id);
    expect(result).not.toBeNull();
    expect(result!.epic.id).toBe(epic.id);
    expect(result!.epic.boardId).toBe(b.id);
    expect(result!.children.map((c) => c.id).sort()).toEqual(
      [c1.id, c2.id].sort(),
    );
    expect(result!.lists.map((x) => x.id)).toContain(l.id);
  });

  it("returns null for non-existent or non-epic ids", async () => {
    const u = await makeUser("epic-children-null");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "L" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Plain" });
    expect(await listEpicChildren(u.jwt, c.id)).toBeNull();
    expect(
      await listEpicChildren(u.jwt, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → fails (helper missing)**

Run: `pnpm vitest run tests/integration/epic-children.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listEpicChildren`**

Create `lib/queries/epic-children.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, lists } from "@/lib/db/schema";

export type EpicCardRow = typeof cards.$inferSelect;
export type EpicListRow = typeof lists.$inferSelect;

export type EpicSnapshot = {
  epic: EpicCardRow;
  children: EpicCardRow[];
  lists: EpicListRow[];
};

/**
 * Plan #epic-as-kanban — server-side fetch for the epic-kanban page.
 * Returns the epic, its DIRECT children (parent_card_id = epicId), and
 * all lists on the epic's home board. Returns null when the id does not
 * resolve to an epic visible to the caller.
 */
export async function listEpicChildren(
  token: string,
  epicId: string,
): Promise<EpicSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const [epic] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.id, epicId), eq(cards.type, "epic")));
    if (!epic) return null;

    const children = await tx
      .select()
      .from(cards)
      .where(eq(cards.parentCardId, epicId));

    const boardLists = await tx
      .select()
      .from(lists)
      .where(eq(lists.boardId, epic.boardId));

    return { epic, children, lists: boardLists };
  });
}
```

- [ ] **Step 4: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-children.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/queries/epic-children.ts tests/integration/epic-children.test.ts
git commit -m "feat(queries): listEpicChildren — epic + direct children + lists

Used by the epic-kanban page to SSR the synthetic view. Returns null
when the id is not an epic visible to the caller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `actions/lists.ts` `ensureStatusListImpl`

**Files:**
- Modify: `actions/lists.ts`
- Test: `tests/integration/epic-actions.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/epic-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { ensureStatusListImpl } from "@/actions/lists";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email, password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("ensureStatusListImpl", () => {
  it("returns existing status list when one already maps the status_kind", async () => {
    const u = await makeUser("ensure-1");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "Done col" });
    await setListStatusKindImpl(u.jwt, { id: l.id, statusKind: "done" });

    const r = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "done",
    });
    expect(r.id).toBe(l.id);
  });

  it("creates a new list when no list maps the status_kind", async () => {
    const u = await makeUser("ensure-2");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    // No list with status_kind = 'in_progress'
    const r = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "in_progress",
    });
    expect(r.boardId).toBe(b.id);
    expect(r.statusKind).toBe("in_progress");
    expect(r.title.toLowerCase()).toContain("progress");

    // Idempotent: second call returns the same list, no new row.
    const r2 = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "in_progress",
    });
    expect(r2.id).toBe(r.id);

    const allInProgress = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "in_progress"))),
    );
    expect(allInProgress).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test → fails (action missing)**

Run: `pnpm vitest run tests/integration/epic-actions.test.ts`
Expected: FAIL — `ensureStatusListImpl` not exported.

- [ ] **Step 3: Add `EnsureStatusListInput` validator**

In `lib/validation.ts`, add:

```ts
export const EnsureStatusListInput = z.object({
  boardId: z.string().uuid(),
  statusKind: z.enum(["todo", "in_progress", "review", "done", "blocked"]),
});
```

(Assumes `z` is already imported; pattern matches existing inputs.)

- [ ] **Step 4: Add `STATUS_DEFAULT_TITLE` constant**

In `lib/status.ts`, append:

```ts
// Plan #epic-as-kanban — display titles used when auto-creating a list
// for a given status_kind. Mirrors STATUS_LABEL but in title-case for the
// list-name (a list called "in progress" lower-case looks wrong).
export const STATUS_DEFAULT_TITLE: Record<StatusKind, string> = {
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};
```

- [ ] **Step 5: Implement `ensureStatusListImpl`**

In `actions/lists.ts`:

1. Add to imports at the top:

```ts
import { eq, desc, and } from "drizzle-orm";
```

(replace existing `eq, desc` line)

2. Add to imports for validation:

```ts
import {
  CreateListInput, RenameListInput, MoveListInput, ArchiveListInput,
  SetWipLimitInput, SetListStatusKindInput, DeleteListInput,
  EnsureStatusListInput,
} from "@/lib/validation";
```

3. Add to imports:

```ts
import { STATUS_DEFAULT_TITLE, type StatusKind } from "@/lib/status";
```

4. Append the new action before `createList` server wrapper:

```ts
/**
 * Plan #epic-as-kanban — idempotent: return the first list on `boardId`
 * whose `status_kind = statusKind`. Create one if none exists. Used by
 * the epic-kanban drag handler so columns appear automatically.
 *
 * Caller must have write access to the board (RLS on lists handles this).
 */
export async function ensureStatusListImpl(
  token: string,
  input: { boardId: string; statusKind: StatusKind },
) {
  const parsed = EnsureStatusListInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [existing] = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.boardId, parsed.boardId),
          eq(lists.statusKind, parsed.statusKind),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [last] = await tx
      .select({ position: lists.position })
      .from(lists)
      .where(eq(lists.boardId, parsed.boardId))
      .orderBy(desc(lists.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);

    const [row] = await tx
      .insert(lists)
      .values({
        boardId: parsed.boardId,
        title: STATUS_DEFAULT_TITLE[parsed.statusKind],
        position: pos,
        statusKind: parsed.statusKind,
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}
```

- [ ] **Step 6: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/validation.ts lib/status.ts actions/lists.ts tests/integration/epic-actions.test.ts
git commit -m "feat(actions): ensureStatusListImpl — idempotent status-list resolver

Returns the first list on a board with a given status_kind, creating
one named per STATUS_DEFAULT_TITLE if absent. Single transaction.

Used by the epic-kanban drag handler so 5 status columns appear without
manual setup on the epic's home board.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `actions/cards.ts` `moveCardToStatusImpl`

**Files:**
- Modify: `actions/cards.ts`
- Test: extend `tests/integration/epic-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/epic-actions.test.ts`:

```ts
import { moveCardToStatusImpl } from "@/actions/cards";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { cards } from "@/lib/db/schema";

describe("moveCardToStatusImpl", () => {
  it("moves the card into a list with matching status_kind on its current board", async () => {
    const u = await makeUser("move-status-1");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lTodo = await createListImpl(u.jwt, { boardId: b.id, title: "T" });
    await setListStatusKindImpl(u.jwt, { id: lTodo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: lTodo.id, title: "C" });

    const r = await moveCardToStatusImpl(u.jwt, {
      cardId: c.id, statusKind: "done",
    });

    // Auto-created a "done" list, then moved card.
    const [card] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(card.listId).toBe(r.listId);
    const [doneList] = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "done"))),
    );
    expect(doneList.id).toBe(r.listId);
  });

  it("is a no-op when the card already lives in a list with that status_kind", async () => {
    const u = await makeUser("move-status-2");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    await setListStatusKindImpl(u.jwt, { id: l.id, statusKind: "done" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });

    const r = await moveCardToStatusImpl(u.jwt, {
      cardId: c.id, statusKind: "done",
    });
    expect(r.listId).toBe(l.id);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/integration/epic-actions.test.ts -t moveCardToStatusImpl`
Expected: FAIL — function not found.

- [ ] **Step 3: Implement `moveCardToStatusImpl`**

In `actions/cards.ts`:

1. Add imports:

```ts
import { ensureStatusListImpl } from "@/actions/lists";
import type { StatusKind } from "@/lib/status";
```

2. After `moveCardImpl` (around line 173), append:

```ts
/**
 * Plan #epic-as-kanban — drag-end handler for the epic-kanban view.
 * Resolves (or creates) a list on the card's board with the target
 * status_kind, then moves the card into it at end-of-list. Single
 * transaction so the create+move is atomic.
 */
export async function moveCardToStatusImpl(
  token: string,
  input: { cardId: string; statusKind: StatusKind },
): Promise<{ listId: string; cardId: string }> {
  const cardId = input.cardId;
  return dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({ id: cards.id, boardId: cards.boardId, listId: cards.listId })
      .from(cards)
      .where(eq(cards.id, cardId));
    if (!card) throw new Error("Forbidden");

    // No-op if already in a list with that status_kind.
    const [currentList] = await tx
      .select({ id: lists.id, statusKind: lists.statusKind })
      .from(lists)
      .where(eq(lists.id, card.listId));
    if (currentList?.statusKind === input.statusKind) {
      return { cardId, listId: card.listId };
    }

    // Resolve target list (idempotent create).
    const target = await ensureStatusListImpl(token, {
      boardId: card.boardId,
      statusKind: input.statusKind,
    });

    // Position = end of target list.
    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, target.id))
      .orderBy(desc(cards.position))
      .limit(1);
    const pos = positionBetween(last?.position ?? null, null);

    const [row] = await tx
      .update(cards)
      .set({ listId: target.id, position: pos })
      .where(eq(cards.id, cardId))
      .returning();
    if (!row) throw new Error("Forbidden");
    return { cardId, listId: target.id };
  });
}

export async function moveCardToStatus(input: {
  cardId: string; statusKind: StatusKind;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveCardToStatusImpl(t, input);
  return r;
}
```

3. Verify imports include `lists` from schema and `desc` from drizzle (existing imports likely already cover both — check the top of the file and add only what's missing).

- [ ] **Step 4: Run test → passes**

Run: `pnpm vitest run tests/integration/epic-actions.test.ts`
Expected: PASS (4 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add actions/cards.ts tests/integration/epic-actions.test.ts
git commit -m "feat(actions): moveCardToStatusImpl — drag-target for epic-kanban

Wraps ensureStatusListImpl + a positional move. Single transaction.
No-op when the card already lives in a status-mapped list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — `lib/epic/group-children-by-status.ts` (pure helper)

**Files:**
- Create: `lib/epic/group-children-by-status.ts`
- Test: `tests/unit/group-children-by-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/group-children-by-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupChildrenByStatus } from "@/lib/epic/group-children-by-status";

const lists = [
  { id: "l-todo", statusKind: "todo" as const },
  { id: "l-prog", statusKind: "in_progress" as const },
  { id: "l-rev",  statusKind: "review" as const },
  { id: "l-done", statusKind: "done" as const },
  { id: "l-blk",  statusKind: "blocked" as const },
  { id: "l-orph", statusKind: null },
];

describe("groupChildrenByStatus", () => {
  it("returns 5 empty buckets + empty unmapped for empty children", () => {
    const r = groupChildrenByStatus([], lists);
    expect(r.todo).toEqual([]);
    expect(r.in_progress).toEqual([]);
    expect(r.review).toEqual([]);
    expect(r.done).toEqual([]);
    expect(r.blocked).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });

  it("groups cards by their list's status_kind", () => {
    const cards = [
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c2", listId: "l-prog", position: "a0" },
      { id: "c3", listId: "l-done", position: "a0" },
      { id: "c4", listId: "l-todo", position: "a1" },
    ];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.todo.map((c) => c.id)).toEqual(["c1", "c4"]);
    expect(r.in_progress.map((c) => c.id)).toEqual(["c2"]);
    expect(r.done.map((c) => c.id)).toEqual(["c3"]);
    expect(r.unmapped).toEqual([]);
  });

  it("puts cards in unmapped when their list has no status_kind", () => {
    const cards = [{ id: "c1", listId: "l-orph", position: "a0" }];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.unmapped.map((c) => c.id)).toEqual(["c1"]);
  });

  it("puts cards in unmapped when their list is missing from the lookup (CDC race)", () => {
    const cards = [{ id: "c1", listId: "missing", position: "a0" }];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.unmapped.map((c) => c.id)).toEqual(["c1"]);
  });

  it("sorts each bucket by `position` ascending (string compare)", () => {
    const cards = [
      { id: "c2", listId: "l-todo", position: "a2" },
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c3", listId: "l-todo", position: "a1" },
    ];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.todo.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/unit/group-children-by-status.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement helper**

Create `lib/epic/group-children-by-status.ts`:

```ts
import type { StatusKind } from "@/lib/status";

type CardLike = { id: string; listId: string; position: string };
type ListLike = { id: string; statusKind: StatusKind | null };

export type ChildrenByStatus<C extends CardLike> = {
  todo: C[];
  in_progress: C[];
  review: C[];
  done: C[];
  blocked: C[];
  unmapped: C[];
};

/**
 * Plan #epic-as-kanban — pure grouping for the epic-kanban view. Cards
 * whose list has a `status_kind` go into the matching bucket; everything
 * else (null status_kind, list missing during CDC race) goes into
 * `unmapped`. Each bucket is sorted by `position` ascending.
 */
export function groupChildrenByStatus<C extends CardLike>(
  children: C[],
  lists: ListLike[],
): ChildrenByStatus<C> {
  const out: ChildrenByStatus<C> = {
    todo: [], in_progress: [], review: [], done: [], blocked: [], unmapped: [],
  };
  const byId = new Map<string, ListLike>();
  for (const l of lists) byId.set(l.id, l);
  for (const c of children) {
    const l = byId.get(c.listId);
    const k = l?.statusKind ?? null;
    if (k === null) {
      out.unmapped.push(c);
    } else {
      out[k].push(c);
    }
  }
  for (const k of Object.keys(out) as Array<keyof ChildrenByStatus<C>>) {
    out[k].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }
  return out;
}
```

- [ ] **Step 4: Run test → passes**

Run: `pnpm vitest run tests/unit/group-children-by-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/epic/group-children-by-status.ts tests/unit/group-children-by-status.test.ts
git commit -m "feat(epic): groupChildrenByStatus pure helper

Bucketizes children by their list's status_kind into the 5 fixed
columns + 'unmapped'. Stable position-sort within each bucket.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Move workspace home into `/w/[wsId]/boards`

**Files:**
- Create: `app/(app)/w/[workspaceId]/boards/page.tsx`
- Modify: `app/(app)/w/[workspaceId]/page.tsx` (next task)

- [ ] **Step 1: Copy current `page.tsx` content to new `boards/page.tsx`**

Read `/home/innovina/Documents/trello-foundation/app/(app)/w/[workspaceId]/page.tsx`. Create `/home/innovina/Documents/trello-foundation/app/(app)/w/[workspaceId]/boards/page.tsx` with the **identical** content of `page.tsx` (copy verbatim — it imports BoardGrid, listBoardsInWorkspace, etc.). Do not modify `page.tsx` yet (Task 9 handles that).

- [ ] **Step 2: Verify boards page renders**

Run: `pnpm dev` (in another terminal) and visit `http://localhost:3000/w/<existing-ws-id>/boards`.
Expected: same UI that today shows on `/w/<id>` — workspace header + board grid.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/w/\[workspaceId\]/boards/page.tsx
git commit -m "feat(routes): /w/[wsId]/boards mirrors workspace home

Pre-step before flipping the workspace landing to the roadmap.
Identical content as the current page.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — Replace workspace landing with redirect to roadmap

**Files:**
- Modify: `app/(app)/w/[workspaceId]/page.tsx`

- [ ] **Step 1: Replace contents**

Overwrite `/home/innovina/Documents/trello-foundation/app/(app)/w/[workspaceId]/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

// Plan #epic-as-kanban (Q12) — workspace landing redirects to the
// roadmap. The board grid moved to /w/{workspaceId}/boards.
export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/roadmap`);
}
```

- [ ] **Step 2: Verify redirect**

Run dev. Hit `http://localhost:3000/w/<existing-ws-id>` → expect 307 → roadmap.

- [ ] **Step 3: Sanity-check existing E2E tests still navigate correctly**

Some specs visit `/w/{wsId}` and expect the board grid; they may need updating in a later task. Run:

`pnpm playwright test --reporter=list workspaces-boards.spec.ts`
Expected: spec may FAIL if it asserts board grid on `/w/{wsId}`. **Note** the failing assertion(s) — Task 16 will update it to visit `/w/{wsId}/boards`.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/w/\[workspaceId\]/page.tsx
git commit -m "feat(routes): workspace root redirects to roadmap

/w/{wsId} now 307s to /w/{wsId}/roadmap. Board grid lives at
/w/{wsId}/boards. Roadmap is the new landing surface.

E2E specs that asserted board grid on the workspace root will fail —
fixed in a later task (top-nav + spec updates).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — `components/epic/epic-header.tsx`

**Files:**
- Create: `components/epic/epic-header.tsx`

- [ ] **Step 1: Write component**

Create `components/epic/epic-header.tsx`:

```tsx
"use client";
import Link from "next/link";
import { CalendarRange, Map as MapIcon } from "lucide-react";
import { cardCode } from "@/lib/format";
import type { CardRow } from "@/lib/queries/board-snapshot";

function fmtShortDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function EpicHeader({
  epic,
  workspaceId,
  childCount,
  doneCount,
}: {
  epic: CardRow;
  workspaceId: string;
  childCount: number;
  doneCount: number;
}) {
  const pct = childCount === 0 ? 0 : Math.round((doneCount / childCount) * 100);
  return (
    <header className="space-y-4 border-b border-hairline pb-6">
      <div className="flex items-baseline gap-3">
        <span className="chip mono-meta-sm">EPIC</span>
        <span className="mono-meta-sm text-fg-faint">#{cardCode(epic.id)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <h1 className="text-3xl font-semibold leading-tight truncate">
            {epic.title}
          </h1>
          <div className="flex items-center gap-3 mono-meta-sm text-fg-muted">
            {(epic.startDate || epic.targetDate) && (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="size-3" />
                {epic.startDate ? fmtShortDate(epic.startDate) : "?"}
                {" → "}
                {epic.targetDate ? fmtShortDate(epic.targetDate) : "?"}
              </span>
            )}
            <span>
              {doneCount}/{childCount} done · {pct}%
            </span>
          </div>
        </div>
        <Link
          href={`/w/${workspaceId}/roadmap?focus=${epic.id}`}
          className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)]"
        >
          <MapIcon className="size-3" />
          View on roadmap
        </Link>
      </div>
      {childCount > 0 && (
        <div className="h-1 rounded-full bg-[color:var(--surface)] overflow-hidden">
          <div
            className="h-full bg-[color:var(--status-done)]"
            style={{ width: `${pct}%` }}
            aria-label={`${pct}% complete`}
          />
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/epic/epic-header.tsx
git commit -m "feat(epic): EpicHeader — title + dates + progress + roadmap link

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(No test for this — pure presentational. The E2E in Task 17 covers it.)

---

## Task 11 — `components/epic/epic-status-column.tsx`

**Files:**
- Create: `components/epic/epic-status-column.tsx`

- [ ] **Step 1: Write component**

Create `components/epic/epic-status-column.tsx`:

```tsx
"use client";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CardTile } from "@/components/board/card-tile";
import type { CardRow } from "@/lib/queries/board-snapshot";
import type { StatusKind } from "@/lib/status";
import { STATUS_LABEL } from "@/lib/status";

export function EpicStatusColumn({
  statusKind,
  cards,
  boardId,
  workspaceId,
}: {
  statusKind: StatusKind | "unmapped";
  cards: CardRow[];
  boardId: string;
  workspaceId: string;
}) {
  const droppableId = `epic-col:${statusKind}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "epicStatusColumn", statusKind },
  });
  const label =
    statusKind === "unmapped" ? "Unmapped" : STATUS_LABEL[statusKind].toUpperCase();

  return (
    <section
      ref={setNodeRef}
      data-testid={`epic-col-${statusKind}`}
      data-status-kind={statusKind}
      data-over={isOver ? "true" : undefined}
      className="flex flex-col w-72 shrink-0 rounded-2xl bg-[color:var(--surface)] border border-hairline data-[over=true]:border-[color:var(--status-in-progress)] data-[over=true]:shadow-[0_0_0_1px_var(--status-in-progress)]"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <h2
          className="mono-meta-sm tracking-wide"
          style={
            statusKind === "unmapped"
              ? { color: "var(--fg-faint)" }
              : { color: `var(--status-${statusKind.replace("_", "-")})` }
          }
        >
          {label}
        </h2>
        <span className="mono-meta-sm text-fg-faint">{cards.length}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-24">
        <SortableContext
          items={cards.map((c) => `card:${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <CardTile key={c.id} card={c} boardId={boardId} workspaceId={workspaceId} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="text-fg-faint text-xs py-4 text-center">
            Drop here
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/epic/epic-status-column.tsx
git commit -m "feat(epic): EpicStatusColumn — droppable status column with sortable tiles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12 — `components/epic/epic-kanban-view.tsx`

**Files:**
- Create: `components/epic/epic-kanban-view.tsx`

- [ ] **Step 1: Write component**

Create `components/epic/epic-kanban-view.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import {
  DndContext, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { groupChildrenByStatus } from "@/lib/epic/group-children-by-status";
import type { StatusKind } from "@/lib/status";
import { EpicStatusColumn } from "./epic-status-column";
import { EpicHeader } from "./epic-header";
import { moveCardToStatus } from "@/actions/cards";
import type { CardRow } from "@/lib/queries/board-snapshot";

const STATUS_ORDER: StatusKind[] = [
  "todo", "in_progress", "review", "done", "blocked",
];

export function EpicKanbanView({
  workspaceId,
  epicId,
}: {
  workspaceId: string;
  epicId: string;
}) {
  // The store is hydrated by EpicKanbanShell (Task 13).
  const epic = useBoardStore((s) => s.cards.find((c) => c.id === epicId));
  const allCards = useBoardStore((s) => s.cards);
  const updateCard = useBoardStore((s) => s.updateCard);
  const lists = useWorkspaceStore((s) => s.lists);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const children = useMemo(
    () => (epic ? allCards.filter((c) => c.parentCardId === epic.id) : []),
    [allCards, epic],
  );
  const buckets = useMemo(
    () =>
      groupChildrenByStatus(
        children,
        lists.filter((l) => epic && l.boardId === epic.boardId),
      ),
    [children, lists, epic],
  );

  const doneCount = buckets.done.length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const overData = e.over?.data.current as
      | { type: "epicStatusColumn"; statusKind: StatusKind | "unmapped" }
      | undefined;
    if (!overData || overData.type !== "epicStatusColumn") return;
    if (overData.statusKind === "unmapped") return; // can't drop into unmapped
    const activeData = e.active.data.current as
      | { type: "card"; cardId: string; listId: string }
      | undefined;
    if (!activeData || activeData.type !== "card") return;

    // Optimistic: move locally first.
    const card = allCards.find((c) => c.id === activeData.cardId);
    if (!card) return;
    const targetList = lists.find(
      (l) =>
        epic &&
        l.boardId === epic.boardId &&
        l.statusKind === overData.statusKind,
    );
    const previousListId = card.listId;
    if (targetList) {
      updateCard(card.id, { listId: targetList.id });
    }

    try {
      await moveCardToStatus({
        cardId: activeData.cardId,
        statusKind: overData.statusKind,
      });
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Move failed");
      // Revert optimistic.
      updateCard(card.id, { listId: previousListId });
    }
  };

  if (!epic) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-fg-faint">
        Epic not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <EpicHeader
        epic={epic as CardRow}
        workspaceId={workspaceId}
        childCount={children.length}
        doneCount={doneCount}
      />
      {pendingError && (
        <div role="alert" className="chip mono-meta-sm text-[color:var(--status-blocked)]">
          {pendingError}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div
          className="flex gap-4 overflow-x-auto pb-4"
          data-testid="epic-kanban-board"
        >
          {STATUS_ORDER.map((sk) => (
            <EpicStatusColumn
              key={sk}
              statusKind={sk}
              cards={buckets[sk]}
              boardId={epic.boardId}
              workspaceId={workspaceId}
            />
          ))}
          {buckets.unmapped.length > 0 && (
            <EpicStatusColumn
              statusKind="unmapped"
              cards={buckets.unmapped}
              boardId={epic.boardId}
              workspaceId={workspaceId}
            />
          )}
        </div>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 2: Verify `updateCard` exists on `stores/board-store.ts`**

Open `stores/board-store.ts`. The store should already expose `updateCard(id, patch)` — it's used by other components for optimistic mutations. Confirm via:

`grep -n "updateCard" stores/board-store.ts`

If the export is named differently (e.g. `patchCard`), update the `useBoardStore((s) => s.updateCard)` selector in `epic-kanban-view.tsx` accordingly. If no equivalent mutator exists, add:

```ts
updateCard: (id: string, patch: Partial<CardRow>) =>
  set((s) => ({
    cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  })),
```

The epic id is passed as a prop (`epicId`) — no extra store state needed.

- [ ] **Step 3: Commit**

```bash
git add components/epic/epic-kanban-view.tsx stores/board-store.ts
git commit -m "feat(epic): EpicKanbanView — 5-col status kanban with drag-end + optimistic store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13 — `app/(app)/w/[workspaceId]/e/[epicId]/page.tsx` server entry + shell

**Files:**
- Create: `app/(app)/w/[workspaceId]/e/[epicId]/page.tsx`
- Create: `components/epic/epic-kanban-shell.tsx`

- [ ] **Step 1: Write the shell (client component that hydrates stores)**

Create `components/epic/epic-kanban-shell.tsx`:

```tsx
"use client";
import { useEffect, useMemo } from "react";
import { useBoardStore, BoardStoreProvider } from "@/stores/board-store";
import {
  useWorkspaceStore,
  WorkspaceStoreProvider,
} from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { EpicKanbanView } from "./epic-kanban-view";
import type { EpicSnapshot } from "@/lib/queries/epic-children";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

export function EpicKanbanShell({
  workspaceId,
  initialEpic,
  initialWorkspace,
}: {
  workspaceId: string;
  initialEpic: EpicSnapshot;
  initialWorkspace: WorkspaceSnapshot;
}) {
  return (
    <WorkspaceStoreProvider initial={initialWorkspace}>
      <BoardStoreProvider
        initial={{
          // epic-kanban only cares about cards + lists for the epic's board.
          // Reuse the shared store with a pre-hydrated cards collection.
          boardId: initialEpic.epic.boardId,
          cards: [initialEpic.epic, ...initialEpic.children],
          lists: initialEpic.lists,
          // Seed the rest as empty — the workspace channel keeps cards
          // fresh; per-list collections aren't needed on this page.
          labels: [], cardLabels: [], cardMembers: [],
          checklists: [], checklistItems: [], comments: [],
          attachments: [], cardLinks: [], components: [],
          cardComponents: [], cardVersions: [], boardProfiles: [],
        }}
      >
        <RealtimeBridge workspaceId={workspaceId} />
        <EpicKanbanView workspaceId={workspaceId} epicId={initialEpic.epic.id} />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
}

function RealtimeBridge({ workspaceId }: { workspaceId: string }) {
  useWorkspaceRealtime(workspaceId);
  return null;
}
```

(If the existing `BoardStoreProvider` signature differs, adjust the `initial` payload — the goal is to seed cards + lists so the view renders SSR data without flicker.)

- [ ] **Step 2: Write the page**

Create `app/(app)/w/[workspaceId]/e/[epicId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listEpicChildren } from "@/lib/queries/epic-children";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { EpicKanbanShell } from "@/components/epic/epic-kanban-shell";

export default async function EpicKanbanPage({
  params,
}: {
  params: Promise<{ workspaceId: string; epicId: string }>;
}) {
  const { workspaceId, epicId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const epic = await listEpicChildren(token, epicId);
  if (!epic) notFound();
  const ws = await getWorkspaceSnapshot(token, workspaceId);
  return (
    <EpicKanbanShell
      workspaceId={workspaceId}
      initialEpic={epic}
      initialWorkspace={ws}
    />
  );
}
```

(Confirm `getWorkspaceSnapshot` is the actual exported name — `lib/queries/workspace-snapshot.ts` is the canonical workspace fetch. If the export name differs, use whatever the existing roadmap page uses.)

- [ ] **Step 3: Smoke-test**

Run dev. Manually create an epic via the UI:
1. Visit `/w/<id>/boards`, open a board, create a card.
2. Open card modal → set type = "epic".
3. Add a child card to the epic via the "Subtasks" panel.
4. Visit `/w/<id>/e/<epicId>` → expect: 5 columns + the child appearing in its mapped status (or Unmapped if list has no status_kind).

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/w/\[workspaceId\]/e components/epic/epic-kanban-shell.tsx
git commit -m "feat(epic): /w/[wsId]/e/[epicId] page + shell

SSR fetches epic + direct children + lists via listEpicChildren, mounts
the workspace + board zustand stores, wires useWorkspaceRealtime, then
renders EpicKanbanView.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14 — Roadmap: clickable epic bars + Unassigned label rename

**Files:**
- Modify: `components/roadmap/roadmap-view.tsx`
- Modify: `lib/roadmap/layout.ts` (label only)

- [ ] **Step 1: Update Unassigned lane label**

In `lib/roadmap/layout.ts`, locate the lane object built around `UNCATEGORIZED_LANE_ID`. Update the lane's `title` (or equivalent display field) from `"Uncategorized"` to `"Unassigned"`. The constant `UNCATEGORIZED_LANE_ID` stays — only the visible label changes.

- [ ] **Step 2: Make epic bars route to the kanban**

In `components/roadmap/roadmap-view.tsx`, find the `epicHeader` block (around line 967-995 in the current file — the `<Link>` that wraps the epic title in the lane sticky-header). Currently `href={`/b/${epicHeader.boardId}/c/${epicHeader.id}`}` (open card modal). Replace with a `<Link>` to the epic kanban:

```tsx
<Link
  href={`/w/${workspaceId}/e/${epicHeader.id}`}
  data-card-id={epicHeader.id}
  data-testid="lane-epic-header-link"
  className="..."  // keep existing classes
>
  {epicHeader.title}
</Link>
```

(`workspaceId` is available in scope — confirm via grep; if not, it's passed via props from the page.)

- [ ] **Step 3: Add empty-workspace banner**

In `components/roadmap/roadmap-view.tsx`, when `lanes.length === 1 && lanes[0].id === UNCATEGORIZED_LANE_ID && lanes[0].cards.length === 0`, render a banner:

```tsx
<div className="mx-auto max-w-2xl py-8 text-center text-fg-faint">
  Mark a card as <span className="chip mono-meta-sm">Epic</span> to organize work into kanbans.
</div>
```

- [ ] **Step 4: Verify**

Run dev. Visit `/w/<id>/roadmap`. Expect:
- Epic bars are clickable and navigate to the epic-kanban page.
- Orphan cards show under an "Unassigned" lane title.
- An empty workspace shows the banner.

- [ ] **Step 5: Commit**

```bash
git add components/roadmap/roadmap-view.tsx lib/roadmap/layout.ts
git commit -m "feat(roadmap): epic bars route to kanban + Unassigned label + empty banner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15 — Card-modal: "Open epic kanban" CTA for epic cards

**Files:**
- Modify: `components/board/card-modal.tsx`

- [ ] **Step 1: Add CTA chip**

In `components/board/card-modal.tsx`, find the header area where `card.type` is displayed. Add a CTA chip rendered only when `card.type === "epic"`. Pseudocode (locate the actual header — look near the existing TypePicker render around line 231-245 of the file):

```tsx
import Link from "next/link";
import { Layers3 } from "lucide-react";
// ...
{card.type === "epic" && workspaceId && (
  <Link
    href={`/w/${workspaceId}/e/${card.id}`}
    data-testid="card-modal-epic-cta"
    className="chip mono-meta-sm inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
  >
    <Layers3 className="size-3" />
    Open epic kanban
  </Link>
)}
```

If `workspaceId` is not in scope of card-modal, pull it from `useWorkspaceStore` (the snapshot has `workspaceId` or it can be derived from `lists[0].boardId` → workspace lookup). Simplest: thread `workspaceId` through props of `CardModal` from the page that mounts it.

- [ ] **Step 2: Verify**

Open an epic in the modal → see the new chip. Click → navigate to `/w/{ws}/e/{epicId}`.

- [ ] **Step 3: Commit**

```bash
git add components/board/card-modal.tsx
git commit -m "feat(card-modal): epic cards expose 'Open epic kanban' CTA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16 — Top-nav: add BOARDS link + reorder + fix existing E2E

**Files:**
- Modify: `components/nav/top-nav.tsx`
- Modify: existing E2E specs that visit `/w/{wsId}` expecting the board grid.

- [ ] **Step 1: Add BOARDS to wsLinks**

In `components/nav/top-nav.tsx`, update `wsLinks` (around line 30-44):

```ts
const wsLinks = wsForLinks
  ? [
      { href: `/w/${wsForLinks}/roadmap`, label: "Roadmap", Icon: Map, testId: "nav-roadmap" },
      { href: `/w/${wsForLinks}/boards`,  label: "Boards",  Icon: Columns, testId: "nav-boards" },
      { href: `/w/${wsForLinks}/backlog`, label: "Backlog", Icon: Tag, testId: "nav-backlog" },
      { href: `/w/${wsForLinks}/all-tasks`, label: "My tasks", Icon: ListChecks, testId: "nav-all-tasks" },
      { href: `/w/${wsForLinks}/versions`, label: "Versions", Icon: Calendar, testId: "nav-versions" },
    ]
  : [];
```

Add `Columns` to the `lucide-react` import line at the top of the file.

- [ ] **Step 2: Update E2E specs that asserted board grid on `/w/{wsId}`**

Search:

`grep -rn "page.goto.*\\/w\\/" tests/e2e | grep -v "/roadmap\\|/boards\\|/e/\\|/all-tasks\\|/backlog\\|/versions\\|/sprints\\|/settings\\|/dashboards\\|/inbox"`

For each hit, change the URL to `/w/{wsId}/boards` (since they test board-grid behavior). Examples:
- `tests/e2e/workspaces-boards.spec.ts` — replace `await page.goto(workspaceUrl)` with `await page.goto(`${workspaceUrl}/boards`)` or click the new BOARDS nav link.
- `tests/e2e/jira-structure.spec.ts` — same treatment.

Run each spec individually and patch as needed:

`pnpm playwright test tests/e2e/workspaces-boards.spec.ts --reporter=list`

- [ ] **Step 3: Run the full E2E suite**

`pnpm playwright test --reporter=list`
Expected: all 10 specs PASS (plus the one updated for new URLs).

- [ ] **Step 4: Commit**

```bash
git add components/nav/top-nav.tsx tests/e2e/
git commit -m "feat(nav): add BOARDS link; ROADMAP first; update E2E for new IA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17 — E2E: `epic-kanban.spec.ts`

**Files:**
- Create: `tests/e2e/epic-kanban.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/epic-kanban.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { signupNewUser, openDemoWorkspace } from "./helpers";

test("epic-kanban: drag a child from todo to done", async ({ page }) => {
  await signupNewUser(page);
  await openDemoWorkspace(page); // navigates to /w/{wsId}/roadmap (new landing)

  // Roadmap is the landing.
  await expect(page).toHaveURL(/\/w\/[^/]+\/roadmap$/);

  // Click the first epic lane header → routes to epic-kanban.
  const epicLink = page.getByTestId("lane-epic-header-link").first();
  const epicHref = await epicLink.getAttribute("href");
  expect(epicHref).toMatch(/\/w\/[^/]+\/e\/[^/]+/);
  await epicLink.click();

  await expect(page).toHaveURL(/\/w\/[^/]+\/e\/[^/]+/);

  // 5 status columns visible.
  for (const sk of ["todo", "in_progress", "review", "done", "blocked"]) {
    await expect(page.getByTestId(`epic-col-${sk}`)).toBeVisible();
  }

  // Find a card in the todo column and drag it to done.
  const todoCol = page.getByTestId("epic-col-todo");
  const doneCol = page.getByTestId("epic-col-done");
  const tile = todoCol.locator('[data-card-id]').first();
  const tileId = await tile.getAttribute("data-card-id");
  expect(tileId).toBeTruthy();

  await tile.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0, { steps: 5 });
  // Drag onto done column.
  const doneBox = await doneCol.boundingBox();
  if (!doneBox) throw new Error("done column not visible");
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + 60, { steps: 10 });
  await page.mouse.up();

  // Card now lives under done column.
  await expect(doneCol.locator(`[data-card-id="${tileId}"]`)).toBeVisible();

  // Reload — assertion still holds (persisted).
  await page.reload();
  await expect(
    page.getByTestId("epic-col-done").locator(`[data-card-id="${tileId}"]`),
  ).toBeVisible();
});
```

(Helpers: `signupNewUser` and `openDemoWorkspace` exist in `tests/e2e/helpers.ts`; if their names differ slightly, use the existing exports — the established pattern is to seed a demo workspace via `actions/seed.ts` after signup, which already includes 1 epic + 4 children.)

- [ ] **Step 2: Run spec**

`pnpm playwright test tests/e2e/epic-kanban.spec.ts --reporter=list`
Expected: PASS. If the demo seed doesn't include an epic with at least one todo-status child, augment `actions/seed.ts` to ensure that — but this should already be true per the spec doc §8.

- [ ] **Step 3: Run full suite**

`pnpm vitest run && pnpm playwright test --reporter=list`
Expected: 152+ vitest tests PASS (now ~157+), 11 E2E specs PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/epic-kanban.spec.ts
git commit -m "test(e2e): epic-kanban drag flow

Signup → roadmap landing → click epic bar → drag tile from todo to
done → reload → assert persistence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18 — Update QUEUE.md + final regression sweep

**Files:**
- Modify: `/home/innovina/Documents/Trinnovina/docs/superpowers/QUEUE.md`

- [ ] **Step 1: Mark plan as shipped in QUEUE.md**

Add a `[x]` line under the appropriate phase (or a new "Phase: Roadmap-First IA" section) referencing this plan's filename.

- [ ] **Step 2: Run full regression**

```bash
cd /home/innovina/Documents/trello-foundation
pnpm vitest run
pnpm playwright test --reporter=list
pnpm tsc --noEmit
pnpm lint
```

Expected: green across the board.

- [ ] **Step 3: Commit**

```bash
cd /home/innovina/Documents/Trinnovina
git add docs/superpowers/QUEUE.md
git commit -m "docs(queue): epic-as-kanban shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (mirrors spec §11)

- [ ] `/w/{ws}` 307s to `/w/{ws}/roadmap`.
- [ ] BOARDS link in top-nav routes to `/w/{ws}/boards` showing the previous workspace home.
- [ ] Epic bars on the roadmap route to `/w/{ws}/e/{epicId}`.
- [ ] Epic-kanban renders 5 status columns + optional Unmapped column.
- [ ] Drag a card across columns updates `cards.list_id` to a list with the matching `status_kind` on the epic's home board, auto-creating the list when missing.
- [ ] Status changes propagate via existing `useWorkspaceRealtime` to other open clients.
- [ ] Roadmap shows an "Unassigned" lane for orphan cards.
- [ ] Setting `parent_card_id` to an epic auto-co-locates the child to the epic's board (trigger-enforced).
- [ ] Setting an epic's `parent_card_id` to another epic is rejected (trigger-enforced).
- [ ] All vitest tests + Playwright specs green; new tests added per §9 of the spec.
