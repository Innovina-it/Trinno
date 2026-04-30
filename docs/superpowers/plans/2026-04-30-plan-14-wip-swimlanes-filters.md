# Plan #14 — WIP Limits + Swimlanes + Quick Filters

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Tighten the kanban board with three power-user extensions:
1. **WIP limits** per list — count chip + red over-limit warning.
2. **Swimlanes** — group cards horizontally by assignee / parent epic / label / sprint.
3. **Quick filters** — chip bar above the board to filter visible cards by member, label, due-status, type. URL-state.

**Architecture:** WIP limit is one new column on `lists`. Swimlanes are a client-only view mode (no schema change) controlled by a workspace cookie or URL param. Quick filters live in URL search params (`?label=X,Y&assignee=me&due=overdue`) and are applied client-side via a memoised selector over the existing zustand store.

**Out of scope:** "Recently viewed" filter (defer), per-user board defaults (defer), saved filter presets (lands in plan #15).

**Definition of done:**
- List header shows `count / limit` chip; turns red `bg-red-900/40 text-red-200` when count exceeds limit.
- Board settings → Lists tab lets admin set/clear WIP limit per list.
- Board view has a swimlane mode toggle: `none | assignee | parent | label | sprint`. URL param `?lanes=assignee` etc.
- When swimlanes are on, lists render once per lane row; cards are partitioned by lane key.
- Filter bar (above lists): chips for current user (toggle "assigned to me"), labels (multi), due (`overdue`, `due-this-week`), card type (epic/story/task/subtask/bug). Each chip toggles a query-string param.
- 3 new integration tests cover: WIP setter, snapshot still works after column add, filter helper logic.
- 57 + 6 tests still pass.

---

## Files

**Migration:** `supabase/migrations/0022_list_wip.sql` — `lists.wip_limit int` nullable.

**Schema:** `lib/db/schema.ts` — add `wipLimit: integer("wip_limit")` to `lists` table.

**Validation:** `lib/validation.ts` — `SetWipLimitInput`.

**Action:** extend `actions/lists.ts` with `setWipLimitImpl` + wrapper.

**Realtime:** `hooks/use-board-realtime.ts` — extend `rowToList` mapper to include `wipLimit`.

**Snapshot:** `lib/queries/board-snapshot.ts` — `ListRow` already inferred from schema, so wipLimit auto-included.

**Components:**
- `components/board/list-column.tsx` — render WIP chip + red over-limit class.
- `components/board/board-filter-bar.tsx` — quick filter chips, URL state.
- `components/board/board-view.tsx` — read URL params, partition cards into lanes when needed.
- `components/board/swimlane-row.tsx` — one row of lists for a single lane key.
- `components/board/list-settings-panel.tsx` — add WIP-limit input next to existing list rename.

**Modify:**
- `app/(app)/b/[boardId]/settings/page.tsx` — add a Lists section with per-list WIP setter.

**Helpers:**
- `lib/board-filters.ts` — `parseFilters(searchParams)`, `applyFilters(cards, filters)`, `partitionLanes(cards, mode, ctx)`.

**Tests:**
- `tests/integration/list-wip.test.ts` — 1 happy + 1 RLS denial.
- `tests/unit/board-filters.test.ts` — pure filter logic + lane partitioning.

---

## Task 1: Migration + schema + realtime mapper

```sql
-- supabase/migrations/0022_list_wip.sql
alter table public.lists add column wip_limit int
  check (wip_limit is null or (wip_limit > 0 and wip_limit <= 999));
```

Drizzle: `wipLimit: integer("wip_limit")` on `lists`.

Update `rowToList` in `hooks/use-board-realtime.ts`: `wipLimit: r.wip_limit ?? null`.

Apply migration + `docker restart supabase_kong_trello-foundation && sleep 2`. 57 tests still pass.

Commit: `feat(db): lists.wip_limit (nullable, 1..999)`

---

## Task 2: Validation + action

`lib/validation.ts`:
```ts
export const SetWipLimitInput = z.object({
  id: Uuid,
  wipLimit: z.number().int().positive().max(999).nullable(),
});
```

`actions/lists.ts` (append impl + wrapper):
```ts
export async function setWipLimitImpl(token: string, input: { id: string; wipLimit: number | null }) {
  const p = SetWipLimitInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(lists).set({ wipLimit: p.wipLimit })
      .where(eq(lists.id, p.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function setWipLimit(input: Parameters<typeof setWipLimitImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setWipLimitImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}
```

(Update import of `SetWipLimitInput` and ensure `lists` is in the file's existing imports.)

Commit: `feat(lists): setWipLimit action`

---

## Task 3: Tests (TDD)

`tests/integration/list-wip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setWipLimitImpl } from "@/actions/lists";

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
  return { l };
}

describe("list wip_limit", () => {
  it("sets and clears a wip limit", async () => {
    const u = await makeUser("wip1");
    const { l } = await setup(u.jwt);
    const updated = await setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 3 });
    expect((updated as { wipLimit?: number | null }).wipLimit).toBe(3);
    const cleared = await setWipLimitImpl(u.jwt, { id: l.id, wipLimit: null });
    expect((cleared as { wipLimit?: number | null }).wipLimit).toBeNull();
  });

  it("rejects out-of-range wip limit", async () => {
    const u = await makeUser("wip2");
    const { l } = await setup(u.jwt);
    await expect(setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 0 })).rejects.toThrow();
    await expect(setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 9999 })).rejects.toThrow();
  });

  it("non-member cannot set wip limit", async () => {
    const owner = await makeUser("wip3");
    const other = await makeUser("wip3o");
    const { l } = await setup(owner.jwt);
    await expect(setWipLimitImpl(other.jwt, { id: l.id, wipLimit: 5 })).rejects.toThrow();
  });
});
```

`tests/unit/board-filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFilters, applyFilters, partitionLanes } from "@/lib/board-filters";

const cards = [
  { id: "c1", title: "Bug fix", listId: "l1", boardId: "b", archived: false, type: "bug", parentCardId: null, dueDate: null, dueComplete: false, sprintId: null, position: "a" },
  { id: "c2", title: "Story",   listId: "l1", boardId: "b", archived: false, type: "story", parentCardId: null, dueDate: new Date(Date.now() - 86400000), dueComplete: false, sprintId: null, position: "b" },
  { id: "c3", title: "Task",    listId: "l2", boardId: "b", archived: false, type: "task", parentCardId: "c2", dueDate: null, dueComplete: false, sprintId: null, position: "c" },
];
const cardLabels = [
  { cardId: "c1", labelId: "lab1" },
  { cardId: "c3", labelId: "lab2" },
];
const cardMembers = [
  { cardId: "c1", userId: "u1" },
];

describe("parseFilters", () => {
  it("parses query params", () => {
    const f = parseFilters(new URLSearchParams("type=bug,task&label=lab1&due=overdue&assignee=me"));
    expect(f.types).toEqual(["bug", "task"]);
    expect(f.labelIds).toEqual(["lab1"]);
    expect(f.due).toBe("overdue");
    expect(f.assignedToMe).toBe(true);
  });

  it("handles empty", () => {
    const f = parseFilters(new URLSearchParams(""));
    expect(f.types).toEqual([]);
    expect(f.labelIds).toEqual([]);
    expect(f.due).toBeNull();
    expect(f.assignedToMe).toBe(false);
  });
});

describe("applyFilters", () => {
  it("filters by type", () => {
    const f = parseFilters(new URLSearchParams("type=bug"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
  });

  it("filters by label intersection (AND across selected)", () => {
    const f = parseFilters(new URLSearchParams("label=lab2"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c3"]);
  });

  it("filters overdue", () => {
    const f = parseFilters(new URLSearchParams("due=overdue"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c2"]);
  });

  it("filters assigned-to-me", () => {
    const f = parseFilters(new URLSearchParams("assignee=me"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("partitionLanes", () => {
  it("partitions by assignee", () => {
    const out = partitionLanes(cards, "assignee", { cardMembers, profiles: [{ id: "u1", displayName: "Alice" }] });
    expect(out.length).toBe(2); // u1 lane + unassigned lane
    const u1Lane = out.find((l) => l.key === "u1");
    expect(u1Lane?.cardIds).toEqual(["c1"]);
    const unassigned = out.find((l) => l.key === "");
    expect(unassigned?.cardIds.sort()).toEqual(["c2", "c3"]);
  });

  it("partitions by parent epic", () => {
    const out = partitionLanes(cards, "parent", {});
    const orphans = out.find((l) => l.key === "");
    expect(orphans?.cardIds.sort()).toEqual(["c1", "c2"]);
    const c2Children = out.find((l) => l.key === "c2");
    expect(c2Children?.cardIds).toEqual(["c3"]);
  });
});
```

Commit: `test(board): list wip + filter parsing + lane partitioning`

---

## Task 4: Filter helper module

`lib/board-filters.ts`:

```ts
export type LaneMode = "none" | "assignee" | "parent" | "label" | "sprint";

export type Filters = {
  types: string[];
  labelIds: string[];
  due: "overdue" | "this-week" | null;
  assignedToMe: boolean;
};

type FilterCard = {
  id: string; title: string; archived: boolean;
  type?: string | null;
  parentCardId?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean | null;
  sprintId?: string | null;
};

export function parseFilters(sp: URLSearchParams): Filters {
  const types = (sp.get("type") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const labelIds = (sp.get("label") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const due = sp.get("due") as Filters["due"];
  const assignedToMe = sp.get("assignee") === "me";
  return {
    types,
    labelIds,
    due: due === "overdue" || due === "this-week" ? due : null,
    assignedToMe,
  };
}

export function serializeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.types.length) sp.set("type", f.types.join(","));
  if (f.labelIds.length) sp.set("label", f.labelIds.join(","));
  if (f.due) sp.set("due", f.due);
  if (f.assignedToMe) sp.set("assignee", "me");
  return sp;
}

export function isFilterActive(f: Filters): boolean {
  return f.types.length > 0 || f.labelIds.length > 0 || f.due !== null || f.assignedToMe;
}

export function applyFilters(
  cards: FilterCard[],
  ctx: {
    cardLabels: { cardId: string; labelId: string }[];
    cardMembers: { cardId: string; userId: string }[];
    currentUserId?: string | null;
  },
  f: Filters,
): FilterCard[] {
  if (!isFilterActive(f)) return cards;
  const labelByCard = new Map<string, Set<string>>();
  for (const cl of ctx.cardLabels) {
    const s = labelByCard.get(cl.cardId) ?? new Set();
    s.add(cl.labelId);
    labelByCard.set(cl.cardId, s);
  }
  const memberByCard = new Map<string, Set<string>>();
  for (const cm of ctx.cardMembers) {
    const s = memberByCard.get(cm.cardId) ?? new Set();
    s.add(cm.userId);
    memberByCard.set(cm.cardId, s);
  }
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  return cards.filter((c) => {
    if (f.types.length && !f.types.includes(c.type ?? "task")) return false;
    if (f.labelIds.length) {
      const labels = labelByCard.get(c.id);
      if (!labels) return false;
      for (const id of f.labelIds) if (!labels.has(id)) return false;
    }
    if (f.due) {
      if (!c.dueDate) return false;
      const d = c.dueDate instanceof Date ? c.dueDate : new Date(c.dueDate);
      if (f.due === "overdue") {
        if (d > now) return false;
        if (c.dueComplete) return false;
      } else if (f.due === "this-week") {
        if (d < now || d > weekAhead) return false;
      }
    }
    if (f.assignedToMe) {
      if (!ctx.currentUserId) return false;
      const mems = memberByCard.get(c.id);
      if (!mems || !mems.has(ctx.currentUserId)) return false;
    }
    return true;
  });
}

export type Lane = { key: string; label: string; cardIds: string[] };

export function partitionLanes(
  cards: FilterCard[],
  mode: LaneMode,
  ctx: {
    cardMembers?: { cardId: string; userId: string }[];
    cardLabels?: { cardId: string; labelId: string }[];
    profiles?: { id: string; displayName: string }[];
    labels?: { id: string; name: string; color?: string }[];
    sprints?: { id: string; name: string }[];
  },
): Lane[] {
  if (mode === "none") return [{ key: "", label: "", cardIds: cards.map((c) => c.id) }];

  const lanes = new Map<string, string[]>();
  const ensure = (k: string) => {
    if (!lanes.has(k)) lanes.set(k, []);
    return lanes.get(k)!;
  };

  if (mode === "assignee") {
    const memMap = new Map<string, string[]>();
    for (const cm of ctx.cardMembers ?? []) {
      const arr = memMap.get(cm.cardId) ?? [];
      arr.push(cm.userId);
      memMap.set(cm.cardId, arr);
    }
    for (const c of cards) {
      const mems = memMap.get(c.id) ?? [];
      if (mems.length === 0) ensure("").push(c.id);
      else for (const u of mems) ensure(u).push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "Unassigned"
        : ctx.profiles?.find((p) => p.id === k)?.displayName ?? "Member";
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "parent") {
    for (const c of cards) {
      ensure(c.parentCardId ?? "").push(c.id);
    }
    const titleByCard = new Map(cards.map((c) => [c.id, c.title]));
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === "" ? "No parent" : titleByCard.get(k) ?? `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "label") {
    const labMap = new Map<string, string[]>();
    for (const cl of ctx.cardLabels ?? []) {
      const arr = labMap.get(cl.cardId) ?? [];
      arr.push(cl.labelId);
      labMap.set(cl.cardId, arr);
    }
    for (const c of cards) {
      const labs = labMap.get(c.id) ?? [];
      if (labs.length === 0) ensure("").push(c.id);
      else for (const l of labs) ensure(l).push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "No label"
        : ctx.labels?.find((l) => l.id === k)?.name || `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "sprint") {
    for (const c of cards) {
      ensure(c.sprintId ?? "").push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "Backlog"
        : ctx.sprints?.find((s) => s.id === k)?.name || `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  return [{ key: "", label: "", cardIds: cards.map((c) => c.id) }];
}

function sortLanes(lanes: Lane[]): Lane[] {
  // Empty/Unassigned/Backlog last; others alphabetical by label.
  return lanes.sort((a, b) => {
    if (a.key === "" && b.key !== "") return 1;
    if (b.key === "" && a.key !== "") return -1;
    return a.label.localeCompare(b.label);
  });
}
```

Run unit tests: 8 PASS in this file. Full suite: 60 + 8 = 68 expected (57 existing + 3 wip + 8 filter = 68).

Wait — let me recount: existing 57, +3 wip integration, +8 filter unit = 68 total.

Commit: `feat(board-filters): URL parser + applyFilters + partitionLanes`

---

## Task 5: BoardFilterBar

`components/board/board-filter-bar.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";
import {
  parseFilters, serializeFilters, isFilterActive,
  type LaneMode,
} from "@/lib/board-filters";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock, User, Tag, X, Layers, ChevronDown,
} from "lucide-react";

const LANE_OPTIONS: { id: LaneMode; label: string }[] = [
  { id: "none",     label: "No swimlanes" },
  { id: "assignee", label: "By assignee" },
  { id: "parent",   label: "By parent" },
  { id: "label",    label: "By label" },
  { id: "sprint",   label: "By sprint" },
];

const TYPE_OPTIONS = ["epic", "story", "task", "subtask", "bug"];

export function BoardFilterBar({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const labels = useBoardStore((s) => s.labels);
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const lanes = (sp.get("lanes") as LaneMode | null) ?? "none";
  const [pending, start] = useTransition();

  function update(next: typeof filters, nextLanes: LaneMode = lanes) {
    const params = serializeFilters(next);
    if (nextLanes !== "none") params.set("lanes", nextLanes);
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  function toggleType(t: string) {
    const has = filters.types.includes(t);
    update({ ...filters, types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t] });
  }
  function toggleLabel(id: string) {
    const has = filters.labelIds.includes(id);
    update({ ...filters, labelIds: has ? filters.labelIds.filter((x) => x !== id) : [...filters.labelIds, id] });
  }
  function setDue(d: typeof filters.due) {
    update({ ...filters, due: filters.due === d ? null : d });
  }
  function toggleMe() {
    update({ ...filters, assignedToMe: !filters.assignedToMe });
  }
  function clear() { update({ types: [], labelIds: [], due: null, assignedToMe: false }, "none"); }

  const active = isFilterActive(filters) || lanes !== "none";
  void currentUserId; void pending;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-hairline bg-[rgb(255_255_255/0.02)]">
      {/* Swimlane mode */}
      <DropdownMenu>
        <DropdownMenuTrigger className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]">
          <Layers className="size-3" />
          {(LANE_OPTIONS.find((l) => l.id === lanes) ?? LANE_OPTIONS[0]).label.toUpperCase()}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={lanes} onValueChange={(v) => update(filters, v as LaneMode)}>
            {LANE_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id}>{o.label}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 h-4 w-px bg-hairline" />

      {/* Assignee = me */}
      <button
        type="button"
        onClick={toggleMe}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.assignedToMe ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <User className="size-3" /> ME
      </button>

      {/* Due */}
      <button
        type="button"
        onClick={() => setDue("overdue")}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.due === "overdue" ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <CalendarClock className="size-3" /> OVERDUE
      </button>
      <button
        type="button"
        onClick={() => setDue("this-week")}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.due === "this-week" ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <CalendarClock className="size-3" /> THIS WEEK
      </button>

      <span className="mx-1 h-4 w-px bg-hairline" />

      {/* Types */}
      {TYPE_OPTIONS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => toggleType(t)}
          className={`chip uppercase hover:bg-[rgb(255_255_255/0.08)] ${
            filters.types.includes(t) ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
          }`}
        >
          {t}
        </button>
      ))}

      {/* Labels */}
      {labels.length > 0 && <span className="mx-1 h-4 w-px bg-hairline" />}
      {labels.slice(0, 8).map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => toggleLabel(l.id)}
          className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
            filters.labelIds.includes(l.id) ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
          }`}
          title={l.name || l.color}
        >
          <Tag className="size-3" />
          {l.name || l.color}
        </button>
      ))}

      {active && (
        <button
          type="button"
          onClick={clear}
          className="chip inline-flex items-center gap-1 ml-auto text-fg-muted hover:text-fg"
        >
          <X className="size-3" /> CLEAR
        </button>
      )}
    </div>
  );
}
```

Commit: `feat(board): BoardFilterBar with URL state + swimlane selector`

---

## Task 6: Wire filters + swimlanes into BoardView

Modify `components/board/board-view.tsx`:

1. Read `useSearchParams()` and parse into filters + lane mode.
2. Use `applyFilters(cards, ctx, filters)` to derive `visibleCards`.
3. Use `partitionLanes(visibleCards, laneMode, laneCtx)` to derive lanes.
4. Render `<BoardFilterBar currentUserId={currentUser.userId} />` between masthead and lists.
5. When `lanes === "none"`: existing rendering (one row of `<ListColumn>`s receiving all visible cards). The `ListColumn` must accept an optional `cardOverrides?: string[]` prop to filter which cards it renders; if absent, default to all cards in its list.
6. When `lanes !== "none"`: for each lane, render a `<SwimlaneRow lane={lane}>` containing the same `<ListColumn>` row but filtered to only this lane's `cardIds`.

`components/board/swimlane-row.tsx`:

```tsx
import type { Lane } from "@/lib/board-filters";

export function SwimlaneRow({
  lane, children,
}: { lane: Lane; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <header className="px-4 py-2 border-y border-hairline bg-[rgb(255_255_255/0.02)] sticky top-14 z-10 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="serif-display text-lg">{lane.label || "—"}</span>
          <span className="mono-meta-sm text-fg-faint">{lane.cardIds.length} CARD{lane.cardIds.length === 1 ? "" : "S"}</span>
        </div>
      </header>
      {children}
    </section>
  );
}
```

`components/board/list-column.tsx` — extend props:

```tsx
{ list, boardId, ordinal, cardIdFilter }: {
  list: ListRow; boardId: string; ordinal?: number;
  cardIdFilter?: Set<string>; // when present, only render these card IDs
}
```

Inside, before mapping cards:
```ts
const filtered = cardIdFilter
  ? listCards.filter((c) => cardIdFilter.has(c.id))
  : listCards;
```
Render `filtered.map(...)`.

Also extend the WIP chip: add count badge in the column header.

```tsx
const overLimit = list.wipLimit != null && filtered.length > list.wipLimit;
// In header:
<span className={`chip tabular-nums ${overLimit ? "bg-red-900/40 text-red-200 ring-1 ring-red-500/30" : ""}`}>
  {filtered.length}{list.wipLimit != null ? `/${list.wipLimit}` : ""}
</span>
```

(Place near the list-ordinal-stamp.)

Commit: `feat(board): apply quick filters + swimlanes + WIP chip on list header`

---

## Task 7: Board settings → WIP setter

Modify `app/(app)/b/[boardId]/settings/page.tsx`:

- Fetch board lists via `getBoardSnapshot` or a smaller helper `listListsForBoard(token, boardId)`.
- Below the board rename/archive/delete forms, add a "Lists" section:

```tsx
<section className="space-y-4">
  <h2 className="mono-meta">Lists</h2>
  <ListsAdminPanel lists={snapshot.lists} />
</section>
```

`components/board/list-settings-panel.tsx` (rename the file or create new `lists-admin-panel.tsx` — pick one and stick with it):

```tsx
"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setWipLimit } from "@/actions/lists";
import { toast } from "sonner";

type ListLite = { id: string; title: string; wipLimit: number | null };

export function ListsAdminPanel({ lists }: { lists: ListLite[] }) {
  return (
    <ul className="divide-y divide-hairline glass rounded-2xl">
      {lists.map((l) => (
        <li key={l.id} className="px-4 py-3 flex items-center gap-3">
          <span className="serif-display text-lg flex-1">{l.title}</span>
          <WipSetter listId={l.id} initial={l.wipLimit ?? null} />
        </li>
      ))}
    </ul>
  );
}

function WipSetter({ listId, initial }: { listId: string; initial: number | null }) {
  const [v, setV] = useState<string>(initial?.toString() ?? "");
  const [pending, start] = useTransition();

  function save() {
    const num = v.trim() === "" ? null : Number(v);
    if (num !== null && (!Number.isInteger(num) || num <= 0 || num > 999)) {
      toast.error("1 to 999 (or empty to clear).");
      return;
    }
    start(async () => {
      try { await setWipLimit({ id: listId, wipLimit: num }); toast.success("Saved."); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="mono-meta-sm text-fg-faint">WIP</span>
      <Input
        value={v} onChange={(e) => setV(e.target.value)}
        type="number" min={1} max={999} placeholder="—"
        className="h-8 w-20 text-center"
      />
      <Button size="xs" onClick={save} disabled={pending}>SAVE</Button>
    </div>
  );
}
```

Commit: `feat(board): board settings — per-list WIP limit setter`

---

## Task 8: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run test:unit` → **68 passing** (57 + 3 wip integration + 8 filter unit)
- `npx playwright test` → 6 passing
- Manual smoke:
  1. Set WIP limit 2 on a list with 3 cards → list header shows `3/2` in red.
  2. Filter bar → click EPIC → lists hide non-epic cards.
  3. Switch swimlanes to "By assignee" → board shows one section per assignee.
  4. URL shows `?lanes=assignee&type=epic`. Refresh page → state persists.
  5. CLEAR resets all filters and lanes.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Planning-4 (WIP + swimlanes) + §Planning-5 (quick filters).
- **Out of scope:** Saved filter presets (plan #15), per-user board defaults, more lane modes (component, version).
- **Hazards:**
  - Filter logic runs client-side on the entire snapshot. For huge boards this could be slow — wrap in `useMemo`.
  - When swimlanes are on, the same list column appears N times (once per lane), each rendering only the relevant cards. dnd-kit drag still works because the `useSortable` IDs are derived from card.id which is global; but cross-lane drag isn't meaningful (it would change the assignee/parent without UI confirmation). For v1, drag still works visually but only commits position changes — assignment changes are NOT auto-applied. That's an explicit non-feature; document.
  - WIP limit is purely advisory — no enforcement at action layer. UI shows red, but cards can still be added.
  - The filter bar shows up to 8 labels inline; "more" overflow is a future polish.
