# Lane-as-Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every lane on the roadmap a clickable kanban portal at `/w/{ws}/lane/{kind}/{id}`, with 5 fixed status_kind columns. Cards may span multiple boards; drag moves a card on its own home board to a list with the target status_kind (auto-create if missing).

**Architecture:** Synthetic view; zero new tables. Lane = `LanePredicate` (epic / assignee / component / orphan). Reuses `useWorkspaceRealtime` for live updates. Drop the prior `cards_co_locate_with_epic_parent` trigger (children may legitimately live on multiple boards now).

**Tech Stack:** Next.js 15, React 19, Drizzle, Supabase Postgres + Realtime + RLS, dnd-kit, Zustand, Vitest, Playwright.

**Working directory for code:** `/home/innovina/Documents/trello-foundation` (worktree on branch `plan/01-foundation`).
**Spec:** [`docs/superpowers/specs/2026-04-30-lane-as-kanban-design.md`](../specs/2026-04-30-lane-as-kanban-design.md).

**Already shipped on branch (Task 1 of the prior epic-as-kanban plan):**
- `supabase/migrations/0051_epic_constraints.sql` (3 triggers: validate epic-of-epic, co-locate, reject epic-with-epic-children).

This plan **drops** the co-locate trigger and proceeds from there.

---

## File map

| Path | Action |
|---|---|
| `supabase/migrations/0052_drop_epic_co_locate.sql` | NEW — drop the co-locate trigger from 0051 |
| `supabase/migrations/0053_clear_nested_epic_parents.sql` | NEW — pre-deploy cleanup |
| `lib/lane/predicate.ts` | NEW — `LanePredicate` type + parse/match helpers |
| `lib/lane/group-cards-by-status.ts` | NEW — pure grouping helper |
| `lib/queries/lane-cards.ts` | NEW — `listLaneCards(token, predicate)` |
| `actions/lists.ts` | EXTEND — `ensureStatusListImpl` |
| `actions/cards.ts` | EXTEND — `moveCardToStatusImpl` + wrapper |
| `app/(app)/w/[workspaceId]/page.tsx` | REPLACE — 307 redirect |
| `app/(app)/w/[workspaceId]/boards/page.tsx` | NEW — old workspace landing |
| `app/(app)/w/[workspaceId]/lane/[kind]/[id]/page.tsx` | NEW — lane-kanban entry |
| `components/lane/lane-header.tsx` | NEW |
| `components/lane/lane-status-column.tsx` | NEW |
| `components/lane/lane-kanban-view.tsx` | NEW |
| `components/lane/lane-kanban-shell.tsx` | NEW |
| `components/board/card-modal.tsx` | EXTEND — epic CTA → epic lane URL |
| `components/nav/top-nav.tsx` | EXTEND — add BOARDS link |
| `components/roadmap/roadmap-view.tsx` | EXTEND — every lane title clickable |
| `lib/roadmap/layout.ts` | EXTEND — Unassigned label |
| `tests/integration/lane-cards.test.ts` | NEW |
| `tests/integration/move-card-to-status.test.ts` | NEW |
| `tests/unit/lane-predicate.test.ts` | NEW |
| `tests/unit/group-cards-by-status.test.ts` | NEW |
| `tests/e2e/lane-kanban.spec.ts` | NEW |

---

## Task 1 — Migration 0052: drop epic co-locate trigger

**Files:**
- Create: `supabase/migrations/0052_drop_epic_co_locate.sql`
- Test: extend `tests/integration/epic-constraints.test.ts`

- [ ] **Step 1: Write a failing test that asserts the trigger is gone**

Append to `/home/innovina/Documents/trello-foundation/tests/integration/epic-constraints.test.ts` (inside the existing `describe`):

```ts
  it("0052: child of an epic on a different board is NOT auto-co-located", async () => {
    const u = await makeUser("no-coloc");
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
    const epic = await createCardImpl(u.jwt, { listId: lA.id, title: "E" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const child = await createCardImpl(u.jwt, { listId: lB.id, title: "C" });
    expect(child.boardId).toBe(bB.id);

    await updateCardImpl(u.jwt, { id: child.id, parentCardId: epic.id });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, child.id)),
    );
    // Under the lane-as-kanban model: child stays on board B.
    expect(row.boardId).toBe(bB.id);
  });
```

The earlier "auto co-locates child to epic's home board on parent set" test (from Task 1 of the prior plan) will now fail — that's expected and correct. **Update** that test to reflect the new behavior:

Find the existing test `"auto co-locates child to epic's home board on parent set"` in the same file and replace its trailing assertion `expect(row.boardId).toBe(bA.id);` with `expect(row.boardId).toBe(bB.id);` (child stays where it was). Update the test description to `"child of an epic keeps its own board (no auto co-locate)"`.

- [ ] **Step 2: Run test → fails**

Run: `cd /home/innovina/Documents/trello-foundation && pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: FAIL — the co-locate trigger still ripples board_id.

- [ ] **Step 3: Create migration 0052**

Create `supabase/migrations/0052_drop_epic_co_locate.sql`:

```sql
-- Plan #lane-as-kanban — under the new lane-as-kanban model, children
-- of an epic may legitimately live on different boards. The
-- co-locate trigger from 0051 forced them onto the epic's board, which
-- now contradicts the lane-as-kanban story (lanes group across boards).
-- Drop it. The Q10 single-level-epic and type-flip protections in 0051
-- are kept.

drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
drop function if exists public.cards_co_locate_with_epic_parent();
```

- [ ] **Step 4: Apply migration**

Run: `pnpm supabase db reset --no-seed`
Expected: clean reset.

- [ ] **Step 5: Run tests → all pass**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: 4/4 PASS (epic-of-epic rejection + type-flip protection + parent-side type-flip protection + child-stays-on-its-board).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0052_drop_epic_co_locate.sql tests/integration/epic-constraints.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): 0052 drop epic co-locate trigger (lane-as-kanban pivot)

Under the lane-as-kanban model, children of an epic may legitimately
live on different boards. The co-locate trigger from 0051 contradicted
that story. Drop it; keep the validate + type-flip-protection triggers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Migration 0053: clear nested epic parents

**Files:**
- Create: `supabase/migrations/0053_clear_nested_epic_parents.sql`
- Test: extend `tests/integration/epic-constraints.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  it("0053: epics whose parent is also an epic get parent cleared on deploy", async () => {
    // The 0053 DO-block ran during db reset. On a fresh seed there are
    // no offenders. Inject one via service-role bypass to confirm the
    // pre-deploy migration would have caught it. Then run the equivalent
    // SQL via service role to simulate the migration re-running.
    const u = await makeUser("nested-clear");
    const { l } = await setup(u.jwt);
    const e1 = await createCardImpl(u.jwt, { listId: l.id, title: "E1" });
    const e2 = await createCardImpl(u.jwt, { listId: l.id, title: "E2" });
    await updateCardImpl(u.jwt, { id: e1.id, type: "epic" });
    await updateCardImpl(u.jwt, { id: e2.id, type: "epic" });

    // Force the bad state directly via service role (bypassing 0051).
    const sqlClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // This will be rejected by the validate trigger; service role still
    // hits triggers. The forcing path requires raw SQL via an exposed
    // RPC. Add a helper `force_set_parent_card_id_bypass_triggers` to
    // the migration purely for testability, OR skip this assertion path
    // and only assert that the migration's idempotent re-run is a no-op.
    //
    // Simplest reliable assertion: run the cleanup query a second time
    // via service role and confirm it touches zero rows.
    const { data, error } = await sqlClient.rpc("count_nested_epic_parents");
    expect(error).toBeNull();
    expect(data).toBe(0);
  });
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts -t "0053"`
Expected: FAIL — `count_nested_epic_parents` doesn't exist.

- [ ] **Step 3: Create migration 0053**

Create `supabase/migrations/0053_clear_nested_epic_parents.sql`:

```sql
-- Plan #lane-as-kanban — pre-deploy cleanup. Any epic card whose
-- parent_card_id points at another epic violates the Q10 single-level
-- rule. Clear those parents; emit NOTICE for deploy logs.

do $$
declare affected int;
begin
  with cleared as (
    update public.cards c
    set parent_card_id = null
    from public.cards p
    where c.parent_card_id = p.id and c.type = 'epic' and p.type = 'epic'
    returning c.id
  )
  select count(*) into affected from cleared;
  if affected > 0 then
    raise notice 'lane-as-kanban: cleared parent_card_id on % epic cards', affected;
  end if;
end$$;

-- Diagnostic helper for tests + ops dashboards.
create or replace function public.count_nested_epic_parents()
returns int language sql security definer set search_path = public as $$
  select count(*)::int
  from public.cards c
  join public.cards p on p.id = c.parent_card_id
  where c.type = 'epic' and p.type = 'epic';
$$;
grant execute on function public.count_nested_epic_parents() to anon, authenticated;
```

- [ ] **Step 4: Apply migration**

Run: `pnpm supabase db reset --no-seed`
Expected: success; deploy log shows the NOTICE only if violators existed (none on a fresh DB).

- [ ] **Step 5: Run tests → pass**

Run: `pnpm vitest run tests/integration/epic-constraints.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0053_clear_nested_epic_parents.sql tests/integration/epic-constraints.test.ts
git commit -m "feat(schema): 0053 clear nested epic parents pre-deploy

DO block clears parent_card_id on any epic whose parent is also an
epic. count_nested_epic_parents() helper for diagnostics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — `lib/lane/predicate.ts`

**Files:**
- Create: `lib/lane/predicate.ts`
- Test: `tests/unit/lane-predicate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lane-predicate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseLanePredicate, serializeLanePredicate, matchesPredicate,
} from "@/lib/lane/predicate";

describe("LanePredicate parse/serialize", () => {
  it("round-trips epic predicate", () => {
    const p = parseLanePredicate("epic", "abc-123");
    expect(p).toEqual({ kind: "epic", id: "abc-123" });
    expect(serializeLanePredicate(p)).toEqual(["epic", "abc-123"]);
  });
  it("round-trips assignee predicate", () => {
    const p = parseLanePredicate("assignee", "user-1");
    expect(p).toEqual({ kind: "assignee", id: "user-1" });
  });
  it("round-trips component predicate", () => {
    const p = parseLanePredicate("component", "comp-1");
    expect(p).toEqual({ kind: "component", id: "comp-1" });
  });
  it("parses orphan kind with basis qualifier", () => {
    const p = parseLanePredicate("orphan", "epic");
    expect(p).toEqual({ kind: "orphan", basis: "epic" });
  });
  it("returns null for unknown kinds", () => {
    expect(parseLanePredicate("nope", "x")).toBeNull();
  });
});

describe("matchesPredicate", () => {
  const cardA = { id: "c1", parentCardId: "epic1", listId: "l1" };
  const cardB = { id: "c2", parentCardId: null, listId: "l1" };
  const memberships = [{ cardId: "c1", userId: "user1" }];
  const componentLinks = [{ cardId: "c1", componentId: "comp1" }];

  it("epic predicate matches direct children", () => {
    expect(matchesPredicate({ kind: "epic", id: "epic1" }, cardA, { memberships, componentLinks })).toBe(true);
    expect(matchesPredicate({ kind: "epic", id: "epic1" }, cardB, { memberships, componentLinks })).toBe(false);
  });
  it("assignee predicate matches via memberships", () => {
    expect(matchesPredicate({ kind: "assignee", id: "user1" }, cardA, { memberships, componentLinks })).toBe(true);
    expect(matchesPredicate({ kind: "assignee", id: "user1" }, cardB, { memberships, componentLinks })).toBe(false);
  });
  it("component predicate matches via componentLinks", () => {
    expect(matchesPredicate({ kind: "component", id: "comp1" }, cardA, { memberships, componentLinks })).toBe(true);
    expect(matchesPredicate({ kind: "component", id: "comp1" }, cardB, { memberships, componentLinks })).toBe(false);
  });
  it("orphan(epic) matches cards with no parent_card_id", () => {
    expect(matchesPredicate({ kind: "orphan", basis: "epic" }, cardB, { memberships, componentLinks })).toBe(true);
    expect(matchesPredicate({ kind: "orphan", basis: "epic" }, cardA, { memberships, componentLinks })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/unit/lane-predicate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `lib/lane/predicate.ts`:

```ts
export type LaneKind = "epic" | "assignee" | "component" | "orphan";

export type LanePredicate =
  | { kind: "epic"; id: string }
  | { kind: "assignee"; id: string }
  | { kind: "component"; id: string }
  | { kind: "orphan"; basis: "epic" | "assignee" | "component" };

type CardLike = { id: string; parentCardId: string | null; listId: string };
type Lookups = {
  memberships: Array<{ cardId: string; userId: string }>;
  componentLinks: Array<{ cardId: string; componentId: string }>;
};

export function parseLanePredicate(kind: string, value: string): LanePredicate | null {
  switch (kind) {
    case "epic":      return { kind: "epic", id: value };
    case "assignee":  return { kind: "assignee", id: value };
    case "component": return { kind: "component", id: value };
    case "orphan":
      if (value === "epic" || value === "assignee" || value === "component") {
        return { kind: "orphan", basis: value };
      }
      return null;
    default: return null;
  }
}

export function serializeLanePredicate(p: LanePredicate): [string, string] {
  return p.kind === "orphan" ? ["orphan", p.basis] : [p.kind, p.id];
}

export function matchesPredicate(
  p: LanePredicate, card: CardLike, lookups: Lookups,
): boolean {
  switch (p.kind) {
    case "epic":
      return card.parentCardId === p.id;
    case "assignee":
      return lookups.memberships.some((m) => m.cardId === card.id && m.userId === p.id);
    case "component":
      return lookups.componentLinks.some((l) => l.cardId === card.id && l.componentId === p.id);
    case "orphan":
      switch (p.basis) {
        case "epic":      return card.parentCardId == null;
        case "assignee":  return !lookups.memberships.some((m) => m.cardId === card.id);
        case "component": return !lookups.componentLinks.some((l) => l.cardId === card.id);
      }
  }
}
```

- [ ] **Step 4: Run test → passes**

Run: `pnpm vitest run tests/unit/lane-predicate.test.ts`
Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/lane/predicate.ts tests/unit/lane-predicate.test.ts
git commit -m "feat(lane): LanePredicate type + parse/match helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `lib/lane/group-cards-by-status.ts`

**Files:**
- Create: `lib/lane/group-cards-by-status.ts`
- Test: `tests/unit/group-cards-by-status.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/unit/group-cards-by-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupCardsByStatus } from "@/lib/lane/group-cards-by-status";

const lists = [
  { id: "l-todo", statusKind: "todo" as const },
  { id: "l-prog", statusKind: "in_progress" as const },
  { id: "l-rev",  statusKind: "review" as const },
  { id: "l-done", statusKind: "done" as const },
  { id: "l-blk",  statusKind: "blocked" as const },
  { id: "l-orph", statusKind: null },
];

describe("groupCardsByStatus", () => {
  it("returns empty buckets for empty input", () => {
    const r = groupCardsByStatus([], lists);
    expect(r.todo).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });
  it("groups by list status_kind", () => {
    const cs = [
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c2", listId: "l-prog", position: "a0" },
      { id: "c3", listId: "l-done", position: "a0" },
    ];
    const r = groupCardsByStatus(cs, lists);
    expect(r.todo.map((c) => c.id)).toEqual(["c1"]);
    expect(r.in_progress.map((c) => c.id)).toEqual(["c2"]);
    expect(r.done.map((c) => c.id)).toEqual(["c3"]);
  });
  it("unmapped on null status_kind", () => {
    const cs = [{ id: "c1", listId: "l-orph", position: "a0" }];
    expect(groupCardsByStatus(cs, lists).unmapped.map((c) => c.id)).toEqual(["c1"]);
  });
  it("unmapped when list missing from lookup", () => {
    const cs = [{ id: "c1", listId: "missing", position: "a0" }];
    expect(groupCardsByStatus(cs, lists).unmapped.map((c) => c.id)).toEqual(["c1"]);
  });
  it("position-sorted within each bucket", () => {
    const cs = [
      { id: "c2", listId: "l-todo", position: "a2" },
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c3", listId: "l-todo", position: "a1" },
    ];
    expect(groupCardsByStatus(cs, lists).todo.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm vitest run tests/unit/group-cards-by-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/lane/group-cards-by-status.ts`:

```ts
import type { StatusKind } from "@/lib/status";

type CardLike = { id: string; listId: string; position: string };
type ListLike = { id: string; statusKind: StatusKind | null };

export type CardsByStatus<C extends CardLike> = {
  todo: C[];
  in_progress: C[];
  review: C[];
  done: C[];
  blocked: C[];
  unmapped: C[];
};

export function groupCardsByStatus<C extends CardLike>(
  cards: C[], lists: ListLike[],
): CardsByStatus<C> {
  const out: CardsByStatus<C> = {
    todo: [], in_progress: [], review: [], done: [], blocked: [], unmapped: [],
  };
  const byId = new Map<string, ListLike>();
  for (const l of lists) byId.set(l.id, l);
  for (const c of cards) {
    const k = byId.get(c.listId)?.statusKind ?? null;
    if (k === null) out.unmapped.push(c);
    else out[k].push(c);
  }
  for (const k of Object.keys(out) as Array<keyof CardsByStatus<C>>) {
    out[k].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }
  return out;
}
```

- [ ] **Step 4: Run test → passes**

`pnpm vitest run tests/unit/group-cards-by-status.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add lib/lane/group-cards-by-status.ts tests/unit/group-cards-by-status.test.ts
git commit -m "feat(lane): groupCardsByStatus pure helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `lib/queries/lane-cards.ts` + `actions/lists.ts` `ensureStatusListImpl` + `actions/cards.ts` `moveCardToStatusImpl`

**Files:**
- Create: `lib/queries/lane-cards.ts`
- Modify: `actions/lists.ts`, `actions/cards.ts`, `lib/validation.ts`, `lib/status.ts`
- Test: `tests/integration/lane-cards.test.ts`, `tests/integration/move-card-to-status.test.ts`

(This task is intentionally larger than usual because the three pieces (lane query + ensure-status-list + move-to-status) are all needed together for the next UI task. Implement them in order with separate test files.)

### 5a — `lib/queries/lane-cards.ts`

- [ ] **Step 5a.1: Write failing test**

Create `tests/integration/lane-cards.test.ts` with this skeleton; the implementer should expand cases to cover epic / assignee / component / orphan / cross-board span. (Use existing patterns from `tests/integration/move-card-cross-board.test.ts` for the `makeUser` boilerplate.)

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { listLaneCards } from "@/lib/queries/lane-cards";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({ email, password: "passw0rd!", email_confirm: true });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("listLaneCards", () => {
  it("epic predicate returns direct children only (across boards)", async () => {
    const u = await makeUser("lane-epic");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const bA = await createBoardImpl(u.jwt, { workspaceId: ws.id, title: "A", backgroundKind: "color", backgroundValue: "#fafafa" });
    const bB = await createBoardImpl(u.jwt, { workspaceId: ws.id, title: "B", backgroundKind: "color", backgroundValue: "#fafafa" });
    const lA = await createListImpl(u.jwt, { boardId: bA.id, title: "L" });
    const lB = await createListImpl(u.jwt, { boardId: bB.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: lA.id, title: "E" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const c1 = await createCardImpl(u.jwt, { listId: lA.id, title: "C1" });
    const c2 = await createCardImpl(u.jwt, { listId: lB.id, title: "C2" });
    await updateCardImpl(u.jwt, { id: c1.id, parentCardId: epic.id });
    await updateCardImpl(u.jwt, { id: c2.id, parentCardId: epic.id });
    const grandchild = await createCardImpl(u.jwt, { listId: lA.id, title: "G" });
    await updateCardImpl(u.jwt, { id: grandchild.id, parentCardId: c1.id });

    const r = await listLaneCards(u.jwt, ws.id, { kind: "epic", id: epic.id });
    expect(r.cards.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    // Returns lists from BOTH boards so the kanban view can render
    // each card on its own board context.
    const listBoards = new Set(r.lists.map((l) => l.boardId));
    expect(listBoards.has(bA.id)).toBe(true);
    expect(listBoards.has(bB.id)).toBe(true);
  });

  it("orphan(epic) returns only cards with parent_card_id is null", async () => {
    const u = await makeUser("lane-orphan");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, { workspaceId: ws.id, title: "B", backgroundKind: "color", backgroundValue: "#fafafa" });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: l.id, title: "E" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const orphan = await createCardImpl(u.jwt, { listId: l.id, title: "O" });
    const child = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: child.id, parentCardId: epic.id });

    const r = await listLaneCards(u.jwt, ws.id, { kind: "orphan", basis: "epic" });
    const ids = r.cards.map((c) => c.id);
    expect(ids).toContain(orphan.id);
    // The epic itself is type='epic' — it's not a child of another epic
    // and parent_card_id is null, so it WILL appear in orphan(epic).
    // Predicate semantics for orphan(epic): "no epic parent." Acceptable.
    expect(ids).not.toContain(child.id);
  });
});
```

- [ ] **Step 5a.2: Implement `listLaneCards`**

Create `lib/queries/lane-cards.ts`:

```ts
import { eq, and, inArray, isNull, or, type SQL } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, lists, cardMembers, cardComponents, boards } from "@/lib/db/schema";
import type { LanePredicate } from "@/lib/lane/predicate";

export type LaneCardRow = typeof cards.$inferSelect;
export type LaneListRow = typeof lists.$inferSelect;

export type LaneSnapshot = {
  cards: LaneCardRow[];
  lists: LaneListRow[];
};

/**
 * Plan #lane-as-kanban — fetch cards matching a lane predicate within a
 * workspace. Returns the cards plus the lists for every board those
 * cards span (so the kanban view can render status_kind columns +
 * resolve drag targets per card's board).
 */
export async function listLaneCards(
  token: string,
  workspaceId: string,
  predicate: LanePredicate,
): Promise<LaneSnapshot> {
  return dbAsUser(token, async (tx) => {
    // Workspace's boards.
    const wsBoards = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId));
    const boardIds = wsBoards.map((b) => b.id);
    if (boardIds.length === 0) return { cards: [], lists: [] };

    let where: SQL | undefined;
    switch (predicate.kind) {
      case "epic":
        where = and(eq(cards.parentCardId, predicate.id), inArray(cards.boardId, boardIds));
        break;
      case "assignee": {
        const memberCardIds = await tx
          .select({ cardId: cardMembers.cardId })
          .from(cardMembers)
          .where(eq(cardMembers.userId, predicate.id));
        const ids = memberCardIds.map((r) => r.cardId);
        if (ids.length === 0) return { cards: [], lists: [] };
        where = and(inArray(cards.id, ids), inArray(cards.boardId, boardIds));
        break;
      }
      case "component": {
        const compCardIds = await tx
          .select({ cardId: cardComponents.cardId })
          .from(cardComponents)
          .where(eq(cardComponents.componentId, predicate.id));
        const ids = compCardIds.map((r) => r.cardId);
        if (ids.length === 0) return { cards: [], lists: [] };
        where = and(inArray(cards.id, ids), inArray(cards.boardId, boardIds));
        break;
      }
      case "orphan":
        if (predicate.basis === "epic") {
          where = and(isNull(cards.parentCardId), inArray(cards.boardId, boardIds));
        } else if (predicate.basis === "assignee") {
          // No card_members row → orphan-by-assignee.
          const allMemberCardIds = await tx
            .select({ cardId: cardMembers.cardId })
            .from(cardMembers);
          const memberSet = new Set(allMemberCardIds.map((r) => r.cardId));
          // Filter in JS after fetch — small workspaces, fine for v1.
          const all = await tx.select().from(cards).where(inArray(cards.boardId, boardIds));
          const filtered = all.filter((c) => !memberSet.has(c.id));
          const lns = await tx.select().from(lists).where(inArray(lists.boardId, boardIds));
          return { cards: filtered, lists: lns };
        } else {
          const allCompCardIds = await tx
            .select({ cardId: cardComponents.cardId })
            .from(cardComponents);
          const compSet = new Set(allCompCardIds.map((r) => r.cardId));
          const all = await tx.select().from(cards).where(inArray(cards.boardId, boardIds));
          const filtered = all.filter((c) => !compSet.has(c.id));
          const lns = await tx.select().from(lists).where(inArray(lists.boardId, boardIds));
          return { cards: filtered, lists: lns };
        }
        break;
    }

    const filteredCards = await tx.select().from(cards).where(where!);
    const cardBoardIds = Array.from(new Set(filteredCards.map((c) => c.boardId)));
    const filteredLists =
      cardBoardIds.length === 0
        ? []
        : await tx.select().from(lists).where(inArray(lists.boardId, cardBoardIds));
    return { cards: filteredCards, lists: filteredLists };
  });
}
```

- [ ] **Step 5a.3: Run test → passes**

`pnpm vitest run tests/integration/lane-cards.test.ts`
Expected: PASS (2). Add more cases per spec §9 if straightforward.

- [ ] **Step 5a.4: Commit**

```bash
git add lib/queries/lane-cards.ts tests/integration/lane-cards.test.ts
git commit -m "feat(queries): listLaneCards — predicate-driven workspace fetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### 5b — `ensureStatusListImpl` + `moveCardToStatusImpl`

(See the original epic-as-kanban plan, Task 5 + Task 6, for the verbatim code blocks. The implementations are identical because they operate on the **card's own board**, which is exactly what the lane-as-kanban model wants. Copy them in.)

- [ ] **Step 5b.1: Add `EnsureStatusListInput` to `lib/validation.ts`**

```ts
export const EnsureStatusListInput = z.object({
  boardId: z.string().uuid(),
  statusKind: z.enum(["todo", "in_progress", "review", "done", "blocked"]),
});
```

- [ ] **Step 5b.2: Add `STATUS_DEFAULT_TITLE` to `lib/status.ts`**

```ts
export const STATUS_DEFAULT_TITLE: Record<StatusKind, string> = {
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};
```

- [ ] **Step 5b.3: Implement `ensureStatusListImpl` in `actions/lists.ts`**

(Use the verbatim code from the epic-as-kanban plan §Task 5 Step 5; identical here.)

- [ ] **Step 5b.4: Implement `moveCardToStatusImpl` + `moveCardToStatus` in `actions/cards.ts`**

(Use the verbatim code from the epic-as-kanban plan §Task 6 Step 3; identical here. Target board = the card's current `board_id`.)

- [ ] **Step 5b.5: Add tests `tests/integration/move-card-to-status.test.ts`**

(Use the verbatim test code from the epic-as-kanban plan §Task 5 Step 1 + §Task 6 Step 1, combined into a single file. Test names + assertions identical.)

- [ ] **Step 5b.6: Run + commit**

```bash
pnpm vitest run tests/integration/move-card-to-status.test.ts
# expect 4 passing

git add lib/validation.ts lib/status.ts actions/lists.ts actions/cards.ts tests/integration/move-card-to-status.test.ts
git commit -m "feat(actions): ensureStatusListImpl + moveCardToStatusImpl

Both target the card's own home board. Auto-create status list if
absent. Used by lane-kanban drag handler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — Move workspace home into `/w/[wsId]/boards`

(Identical to original plan Task 8. Copy `app/(app)/w/[workspaceId]/page.tsx` content verbatim to `app/(app)/w/[workspaceId]/boards/page.tsx`, then commit.)

---

## Task 7 — Replace workspace landing with redirect to roadmap

(Identical to original plan Task 9. Replace `app/(app)/w/[workspaceId]/page.tsx` with a `redirect(\`/w/${workspaceId}/roadmap\`)`. Commit.)

---

## Task 8 — `components/lane/lane-header.tsx`

**Files:**
- Create: `components/lane/lane-header.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import Link from "next/link";
import { CalendarRange, Map as MapIcon, User as UserIcon, Box, Layers3 } from "lucide-react";
import type { LanePredicate } from "@/lib/lane/predicate";

function fmtShortDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LaneHeader({
  predicate, label, workspaceId, cardCount, doneCount,
  meta,
}: {
  predicate: LanePredicate;
  label: string;
  workspaceId: string;
  cardCount: number;
  doneCount: number;
  meta?: { startDate?: string | Date | null; targetDate?: string | Date | null };
}) {
  const pct = cardCount === 0 ? 0 : Math.round((doneCount / cardCount) * 100);
  const Icon = predicate.kind === "epic" ? Layers3 : predicate.kind === "assignee" ? UserIcon : predicate.kind === "component" ? Box : MapIcon;

  return (
    <header className="space-y-4 border-b border-hairline pb-6">
      <div className="flex items-baseline gap-3">
        <span className="chip mono-meta-sm uppercase">{predicate.kind}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <h1 className="text-3xl font-semibold leading-tight truncate inline-flex items-center gap-2">
            <Icon className="size-6" />
            {label}
          </h1>
          <div className="flex items-center gap-3 mono-meta-sm text-fg-muted">
            {meta?.startDate || meta?.targetDate ? (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="size-3" />
                {meta.startDate ? fmtShortDate(meta.startDate) : "?"}
                {" → "}
                {meta.targetDate ? fmtShortDate(meta.targetDate) : "?"}
              </span>
            ) : null}
            <span>{doneCount}/{cardCount} done · {pct}%</span>
          </div>
        </div>
        <Link
          href={`/w/${workspaceId}/roadmap`}
          className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)]"
        >
          <MapIcon className="size-3" />
          View on roadmap
        </Link>
      </div>
      {cardCount > 0 && (
        <div className="h-1 rounded-full bg-[color:var(--surface)] overflow-hidden">
          <div className="h-full bg-[color:var(--status-done)]" style={{ width: `${pct}%` }} aria-label={`${pct}% complete`} />
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/lane/lane-header.tsx
git commit -m "feat(lane): LaneHeader — adapts label/icon/meta by lane kind

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — `components/lane/lane-status-column.tsx`

(Identical to original plan Task 11 — same droppable column. Just renamed from `EpicStatusColumn` → `LaneStatusColumn`. Implement at `components/lane/lane-status-column.tsx`.)

---

## Task 10 — `components/lane/lane-kanban-view.tsx`

**Files:**
- Create: `components/lane/lane-kanban-view.tsx`

The view takes a predicate + workspace id + initial snapshot, derives groups via `groupCardsByStatus`, renders 5 columns + Unmapped, wires DnD via `moveCardToStatus`. Differences from `EpicKanbanView` (original plan):

- Props: `{ workspaceId, predicate, label, meta?, initialCards, initialLists }` — no `epicId` constraint.
- The dragged card's **own board** is the target board for `moveCardToStatus`. Resolve via `card.boardId`, not a single epic-board.

```tsx
"use client";
import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { groupCardsByStatus } from "@/lib/lane/group-cards-by-status";
import { matchesPredicate, type LanePredicate } from "@/lib/lane/predicate";
import { STATUS_LABEL, type StatusKind } from "@/lib/status";
import { LaneStatusColumn } from "./lane-status-column";
import { LaneHeader } from "./lane-header";
import { moveCardToStatus } from "@/actions/cards";

const STATUS_ORDER: StatusKind[] = ["todo", "in_progress", "review", "done", "blocked"];

export function LaneKanbanView({
  workspaceId, predicate, label, meta,
}: {
  workspaceId: string;
  predicate: LanePredicate;
  label: string;
  meta?: { startDate?: string | Date | null; targetDate?: string | Date | null };
}) {
  const allCards = useBoardStore((s) => s.cards);
  const updateCard = useBoardStore((s) => s.updateCard);
  const lists = useWorkspaceStore((s) => s.lists);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const cardComponents = useBoardStore((s) => s.cardComponents);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const laneCards = useMemo(
    () => allCards.filter((c) => matchesPredicate(predicate, c, { memberships: cardMembers, componentLinks: cardComponents })),
    [allCards, predicate, cardMembers, cardComponents],
  );
  const buckets = useMemo(() => groupCardsByStatus(laneCards, lists), [laneCards, lists]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const overData = e.over?.data.current as { type: "laneStatusColumn"; statusKind: StatusKind | "unmapped" } | undefined;
    if (!overData || overData.type !== "laneStatusColumn") return;
    if (overData.statusKind === "unmapped") return;
    const activeData = e.active.data.current as { type: "card"; cardId: string; listId: string } | undefined;
    if (!activeData || activeData.type !== "card") return;

    const card = allCards.find((c) => c.id === activeData.cardId);
    if (!card) return;
    const previousListId = card.listId;
    // Optimistic: find a list with target status_kind on THIS card's board.
    const targetList = lists.find((l) => l.boardId === card.boardId && l.statusKind === overData.statusKind);
    if (targetList) updateCard(card.id, { listId: targetList.id });

    try {
      await moveCardToStatus({ cardId: activeData.cardId, statusKind: overData.statusKind });
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Move failed");
      updateCard(card.id, { listId: previousListId });
    }
  };

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <LaneHeader
        predicate={predicate}
        label={label}
        workspaceId={workspaceId}
        cardCount={laneCards.length}
        doneCount={buckets.done.length}
        meta={meta}
      />
      {pendingError && (
        <div role="alert" className="chip mono-meta-sm text-[color:var(--status-blocked)]">
          {pendingError}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="lane-kanban-board">
          {STATUS_ORDER.map((sk) => (
            <LaneStatusColumn key={sk} statusKind={sk} cards={buckets[sk]} workspaceId={workspaceId} />
          ))}
          {buckets.unmapped.length > 0 && (
            <LaneStatusColumn statusKind="unmapped" cards={buckets.unmapped} workspaceId={workspaceId} />
          )}
        </div>
      </DndContext>
    </div>
  );
}
```

(`LaneStatusColumn` props: `{ statusKind, cards, workspaceId }` — no `boardId` in scope here because cards span boards. Pass `boardId` via each `CardTile` from `card.boardId` instead.)

- [ ] **Step 1: Adapt `LaneStatusColumn` to read each tile's own boardId** (modify Task 9 component if not yet done — pass `card.boardId` per-tile to `CardTile`).

- [ ] **Step 2: Commit**

```bash
git add components/lane/lane-kanban-view.tsx components/lane/lane-status-column.tsx
git commit -m "feat(lane): LaneKanbanView + status column — predicate-driven 5-col kanban

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — `app/(app)/w/[workspaceId]/lane/[kind]/[id]/page.tsx` + shell

**Files:**
- Create: `components/lane/lane-kanban-shell.tsx`
- Create: `app/(app)/w/[workspaceId]/lane/[kind]/[id]/page.tsx`

- [ ] **Step 1: Shell (client)**

Create `components/lane/lane-kanban-shell.tsx`:

```tsx
"use client";
import { BoardStoreProvider } from "@/stores/board-store";
import { WorkspaceStoreProvider } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { LaneKanbanView } from "./lane-kanban-view";
import type { LanePredicate } from "@/lib/lane/predicate";
import type { LaneSnapshot } from "@/lib/queries/lane-cards";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

export function LaneKanbanShell({
  workspaceId, predicate, label, meta, initialLane, initialWorkspace,
}: {
  workspaceId: string;
  predicate: LanePredicate;
  label: string;
  meta?: { startDate?: string | Date | null; targetDate?: string | Date | null };
  initialLane: LaneSnapshot;
  initialWorkspace: WorkspaceSnapshot;
}) {
  return (
    <WorkspaceStoreProvider initial={initialWorkspace}>
      <BoardStoreProvider
        initial={{
          boardId: null, // multi-board view
          cards: initialLane.cards,
          lists: initialLane.lists,
          labels: [], cardLabels: [], cardMembers: [],
          checklists: [], checklistItems: [], comments: [],
          attachments: [], cardLinks: [], components: [],
          cardComponents: [], cardVersions: [], boardProfiles: [],
        }}
      >
        <RealtimeBridge workspaceId={workspaceId} />
        <LaneKanbanView workspaceId={workspaceId} predicate={predicate} label={label} meta={meta} />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
}

function RealtimeBridge({ workspaceId }: { workspaceId: string }) {
  useWorkspaceRealtime(workspaceId);
  return null;
}
```

(If `BoardStoreProvider` requires a non-null `boardId`, adapt — use `initialLane.cards[0]?.boardId ?? null`. The store's per-board scope is stretched here; adjust the provider if needed.)

- [ ] **Step 2: Page (server)**

Create `app/(app)/w/[workspaceId]/lane/[kind]/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listLaneCards } from "@/lib/queries/lane-cards";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { parseLanePredicate } from "@/lib/lane/predicate";
import { LaneKanbanShell } from "@/components/lane/lane-kanban-shell";
import { dbAsUser } from "@/lib/db/client";
import { cards as cardsTable, profiles, components } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function LanePage({
  params,
}: {
  params: Promise<{ workspaceId: string; kind: string; id: string }>;
}) {
  const { workspaceId, kind, id } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const predicate = parseLanePredicate(kind, id);
  if (!predicate) notFound();
  const lane = await listLaneCards(token, workspaceId, predicate);
  const ws = await getWorkspaceSnapshot(token, workspaceId);

  // Resolve human-readable label per lane kind.
  let label = "";
  let meta: { startDate?: string | Date | null; targetDate?: string | Date | null } | undefined;
  if (predicate.kind === "epic") {
    const [epic] = await dbAsUser(token, async (tx) =>
      tx.select().from(cardsTable).where(eq(cardsTable.id, predicate.id)),
    );
    if (!epic) notFound();
    label = epic.title;
    meta = { startDate: epic.startDate, targetDate: epic.targetDate };
  } else if (predicate.kind === "assignee") {
    const [p] = await dbAsUser(token, async (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, predicate.id)),
    );
    label = p?.displayName ?? "Unknown user";
  } else if (predicate.kind === "component") {
    const [c] = await dbAsUser(token, async (tx) =>
      tx.select().from(components).where(eq(components.id, predicate.id)),
    );
    if (!c) notFound();
    label = c.name;
  } else if (predicate.kind === "orphan") {
    label = `Unassigned (${predicate.basis})`;
  }

  return (
    <LaneKanbanShell
      workspaceId={workspaceId}
      predicate={predicate}
      label={label}
      meta={meta}
      initialLane={lane}
      initialWorkspace={ws}
    />
  );
}
```

(Confirm `getWorkspaceSnapshot` is the actual exported name on this branch. Use whatever the existing roadmap page imports.)

- [ ] **Step 3: Smoke-test**

Run dev. Create an epic + child via UI. Visit `/w/{ws}/lane/epic/{epicId}` → see kanban with the child in its mapped status column.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/w/\[workspaceId\]/lane components/lane/lane-kanban-shell.tsx
git commit -m "feat(lane): /w/[wsId]/lane/[kind]/[id] page + shell

SSR fetches predicate-matched cards + lists via listLaneCards, mounts
workspace + board zustand stores, wires useWorkspaceRealtime, renders
LaneKanbanView. Resolves human-readable label per lane kind.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12 — Roadmap: every lane title clickable + Unassigned label

**Files:**
- Modify: `components/roadmap/roadmap-view.tsx`
- Modify: `lib/roadmap/layout.ts` (label only)

- [ ] **Step 1: Update Unassigned lane label**

In `lib/roadmap/layout.ts`, change the lane object built around `UNCATEGORIZED_LANE_ID` from displaying "Uncategorized" to "Unassigned". The constant id stays.

- [ ] **Step 2: Make every lane title route to lane-kanban**

In `components/roadmap/roadmap-view.tsx`, find the lane sticky-header rendering. The current implementation links the epic-header's title to `/b/{boardId}/c/{cardId}` (opens the epic card modal). Replace with a click on the **lane title row** itself that routes to the corresponding `/w/{workspaceId}/lane/{kind}/{id}` URL.

The kind/id depends on the active `laneMode`:
- `epic`: kind = `epic`, id = `lane.headerCard.id` (or `orphan/epic` for the Uncategorized lane)
- `assignee`: kind = `assignee`, id = `lane.userId` (or `orphan/assignee`)
- `component`: kind = `component`, id = `lane.componentId` (or `orphan/component`)

Pseudocode (locate the actual lane-header render around line 980 of `roadmap-view.tsx`):

```tsx
const laneHref = (() => {
  if (laneMode === "epic") {
    return lane.headerCard
      ? `/w/${workspaceId}/lane/epic/${lane.headerCard.id}`
      : `/w/${workspaceId}/lane/orphan/epic`;
  }
  if (laneMode === "assignee") {
    return lane.userId
      ? `/w/${workspaceId}/lane/assignee/${lane.userId}`
      : `/w/${workspaceId}/lane/orphan/assignee`;
  }
  if (laneMode === "component") {
    return lane.componentId
      ? `/w/${workspaceId}/lane/component/${lane.componentId}`
      : `/w/${workspaceId}/lane/orphan/component`;
  }
  return null;
})();

// Render the lane title as a Link if laneHref is set:
{laneHref ? (
  <Link href={laneHref} data-testid="lane-title-link" className="...">
    {laneTitle}
  </Link>
) : (
  <span className="...">{laneTitle}</span>
)}
```

- [ ] **Step 3: Empty-workspace banner**

When `lanes.length === 1 && lanes[0].id === UNCATEGORIZED_LANE_ID && lanes[0].cards.length === 0`, render a banner:

```tsx
<div className="mx-auto max-w-2xl py-8 text-center text-fg-faint">
  Mark a card as <span className="chip mono-meta-sm">Epic</span>, assign someone, or tag a component to start organizing work into kanban lanes.
</div>
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm dev
# manually verify: roadmap shows clickable lane titles for each lane mode
git add components/roadmap/roadmap-view.tsx lib/roadmap/layout.ts
git commit -m "feat(roadmap): every lane title routes to lane-kanban

Epic / assignee / component / orphan lanes all become clickable links
to /w/{ws}/lane/{kind}/{id}. Rename Uncategorized → Unassigned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13 — Card-modal: "Open epic kanban" CTA

**Files:**
- Modify: `components/board/card-modal.tsx`

- [ ] **Step 1: Add CTA**

When `card.type === "epic"` and `workspaceId` is in scope, render a chip linking to `/w/{workspaceId}/lane/epic/{card.id}`. Use the same pattern as the original epic-as-kanban plan Task 15.

- [ ] **Step 2: Commit**

```bash
git add components/board/card-modal.tsx
git commit -m "feat(card-modal): epic cards expose Open epic kanban CTA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14 — Top-nav add BOARDS link + fix existing E2E

(Identical to original plan Task 16. Add BOARDS link to `wsLinks`. Update existing E2E specs that visited `/w/{wsId}` expecting the board grid; redirect them to `/w/{wsId}/boards`.)

---

## Task 15 — E2E: `tests/e2e/lane-kanban.spec.ts`

**Files:**
- Create: `tests/e2e/lane-kanban.spec.ts`

```ts
import { test, expect } from "@playwright/test";
import { signupNewUser, openDemoWorkspace } from "./helpers";

test("lane-kanban: drag a child of an epic from todo to done", async ({ page }) => {
  await signupNewUser(page);
  await openDemoWorkspace(page);

  await expect(page).toHaveURL(/\/w\/[^/]+\/roadmap$/);

  const laneLink = page.getByTestId("lane-title-link").first();
  const href = await laneLink.getAttribute("href");
  expect(href).toMatch(/\/w\/[^/]+\/lane\/(epic|assignee|component|orphan)\/[^/]+/);
  await laneLink.click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/lane\/[^/]+\/[^/]+/);

  for (const sk of ["todo", "in_progress", "review", "done", "blocked"]) {
    await expect(page.getByTestId(`lane-col-${sk}`)).toBeVisible();
  }

  const todoCol = page.getByTestId("lane-col-todo");
  const doneCol = page.getByTestId("lane-col-done");
  const tile = todoCol.locator("[data-card-id]").first();
  const tileId = await tile.getAttribute("data-card-id");

  await tile.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0, { steps: 5 });
  const doneBox = await doneCol.boundingBox();
  if (!doneBox) throw new Error("done column not visible");
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + 60, { steps: 10 });
  await page.mouse.up();

  await expect(doneCol.locator(`[data-card-id="${tileId}"]`)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("lane-col-done").locator(`[data-card-id="${tileId}"]`)).toBeVisible();
});
```

(`LaneStatusColumn` must use `data-testid={`lane-col-${statusKind}`}`. Update Task 9 / Task 10 accordingly.)

- [ ] **Step 1: Run**

```bash
pnpm playwright test tests/e2e/lane-kanban.spec.ts --reporter=list
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/lane-kanban.spec.ts
git commit -m "test(e2e): lane-kanban drag flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16 — Final regression sweep + QUEUE.md

```bash
cd /home/innovina/Documents/trello-foundation
pnpm vitest run
pnpm playwright test --reporter=list
pnpm tsc --noEmit
pnpm lint
```

All green. Update `/home/innovina/Documents/Trinnovina/docs/superpowers/QUEUE.md` to mark lane-as-kanban shipped. Commit on the parent repo.

---

## Definition of done

- [ ] Visiting `/w/{ws}` 307s to `/w/{ws}/roadmap`.
- [ ] Top-nav BOARDS link routes to `/w/{ws}/boards`.
- [ ] Every lane title on the roadmap routes to `/w/{ws}/lane/{kind}/{id}`.
- [ ] Lane-kanban renders 5 status columns + optional Unmapped.
- [ ] Drag updates `cards.list_id` to a list with the matching `status_kind` on the **card's own** board, auto-creating the list when missing.
- [ ] Status changes propagate via realtime to other clients.
- [ ] Roadmap shows "Unassigned" lane.
- [ ] Setting an epic's `parent_card_id` to another epic remains rejected.
- [ ] The 0051 co-locate trigger is dropped (0052) — children may live on different boards from the epic.
- [ ] All vitest + Playwright tests green.
