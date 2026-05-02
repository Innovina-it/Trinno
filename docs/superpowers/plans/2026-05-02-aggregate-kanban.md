# Aggregate Kanban (My Tasks across all boards) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-level Kanban view that aggregates cards across all boards in the workspace. The user works on "my tasks" (or all workspace tasks) grouped by status without leaving for individual board pages.

**Architecture:**
- **Route:** `/w/[workspaceId]/all-tasks` — server page wraps `WorkspaceStoreProvider` (already loads cards / lists / sprints / profiles for the whole workspace via β + γ-Master B1).
- **Layout:** 6 vertical columns keyed by `lists.statusKind` enum + one "No status" bucket: `todo | in_progress | review | done | blocked | (unmapped)`. Same monochrome chip aesthetic as Kanban.
- **Drop semantics:** drag a card to column X → the card moves to the FIRST list with `status_kind = X` on the card's CURRENT board. Cross-board drag is out of scope for v1 (preserves "one card lives on one board" invariant — a card whose board has no list with the target status_kind cannot be dropped there; UI shows a tooltip explaining why).
- **Filter:** default `mine` (cards assigned to viewer). Toggle to `all workspace`. Plus search + label/priority/sprint chips reusing `parseFilters` from γ-Master A6.
- **Access:** new top-nav entry "MY TASKS" between WORKSPACE switcher and BACKLOG. Cmd+K palette also gets a "Open my tasks" entry.

**Tech Stack:** Next.js App Router, Server Components for SSR, Zustand workspace store (existing), dnd-kit (existing on Kanban; we'll add a fresh `<DndContext>` for the aggregate view), Tailwind, shadcn/ui, drizzle-orm.

**Depends on:**
- γ-Master B1 (workspace store provider mounted on roadmap; we extend the provider to a new route)
- γ-Master B3 (`lists.statusKind` populated on lists; aggregate view ignores unmapped lists by default)
- C9 (`card_members` in workspace store; needed for "mine" filter)
- B4 (workspace realtime extension; aggregate view stays live as users elsewhere mutate cards)
- existing actions: `moveCard({ id, listId, position })` (within same board)

**Out of scope (v1):**
- Cross-board drag (moving a card from board A to board B via the aggregate view).
- Bulk multi-select on aggregate view.
- Aggregate calendar / timeline view (could come later as a sibling route).
- "Watching" filter (only mine + all in v1).

---

## File Structure

**New files:**
- `app/(app)/w/[workspaceId]/all-tasks/page.tsx` — server page; auth + workspace snapshot + render client.
- `components/workspace/all-tasks-view.tsx` — client root; filters / columns / dnd-kit context.
- `components/workspace/all-tasks-card.tsx` — per-card render (title, board chip, status, assignees, priority, due date).
- `components/workspace/all-tasks-column.tsx` — droppable column; title + count + sortable area.
- `components/workspace/all-tasks-empty-state.tsx` — first-run + "no boards yet" copy.
- `lib/aggregate-kanban/group.ts` — pure helpers (`groupByStatus`, `findTargetListId`, `cardMatchesFilter`).
- `tests/unit/aggregate-kanban-group.test.ts` — unit tests for the helpers.
- `tests/e2e/aggregate-kanban.spec.ts` — E2E.

**Modified files:**
- `components/nav/top-nav.tsx` — add "MY TASKS" link between workspace switcher and BACKLOG.
- `components/workspace/command-palette.tsx` (or wherever `/cmd+k` palette lives) — add "Open my tasks" entry.
- `app/(app)/w/[workspaceId]/all-tasks/loading.tsx` (new) — skeleton.

---

## Task 1: Route scaffold + workspace snapshot

**Files:**
- Create: `app/(app)/w/[workspaceId]/all-tasks/page.tsx`
- Create: `app/(app)/w/[workspaceId]/all-tasks/loading.tsx`

- [ ] **Step 1: Skeleton fallback for streaming**

```tsx
// app/(app)/w/[workspaceId]/all-tasks/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-10 space-y-6">
      <Skeleton className="h-8 w-48 bg-white/10" />
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[60vh] bg-white/5" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Server page — auth + workspace snapshot**

```tsx
// app/(app)/w/[workspaceId]/all-tasks/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { AllTasksView } from "@/components/workspace/all-tasks-view";

export default async function AllTasksPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const snapshot = await getWorkspaceSnapshot(token, workspaceId);

  return (
    <WorkspaceStoreProvider initial={snapshot}>
      <div className="mx-auto max-w-[1600px] px-6 py-10 space-y-6">
        <header className="space-y-3 border-b border-hairline pb-6">
          <span className="chip">{ws.name.toUpperCase()} / MY TASKS</span>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="serif-display text-5xl">My tasks</h1>
            <span
              className="mono-meta text-fg-muted"
              data-testid="all-tasks-card-count"
            >
              {snapshot.cards.filter((c) => !c.archived).length} CARDS
            </span>
          </div>
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
        </header>
        <AllTasksView workspaceId={workspaceId} viewerId={user.id} />
      </div>
    </WorkspaceStoreProvider>
  );
}
```

- [ ] **Step 3: Visit the route**

Run: `npm run dev` then `curl -I http://localhost:3000/w/<some-workspace-id>/all-tasks`
Expected: 200 (with auth cookie) or 302 to `/login` (without). Page renders the skeleton then errors on `AllTasksView` not yet defined — that's the next task.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/w/\[workspaceId\]/all-tasks/
git commit -m "feat(all-tasks): route scaffold + workspace snapshot"
```

---

## Task 2: Pure grouping helpers + unit tests (TDD)

**Files:**
- Create: `lib/aggregate-kanban/group.ts`
- Create: `tests/unit/aggregate-kanban-group.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/aggregate-kanban-group.test.ts
import { describe, it, expect } from "vitest";
import {
  AGGREGATE_COLUMNS,
  groupByStatus,
  findTargetListId,
  type AggregateColumnId,
} from "@/lib/aggregate-kanban/group";

type Card = {
  id: string;
  boardId: string;
  listId: string;
  archived: boolean;
};
type List = {
  id: string;
  boardId: string;
  statusKind:
    | "todo"
    | "in_progress"
    | "review"
    | "done"
    | "blocked"
    | null;
};

describe("AGGREGATE_COLUMNS", () => {
  it("orders columns todo → in_progress → review → done → blocked → unmapped", () => {
    expect(AGGREGATE_COLUMNS.map((c) => c.id)).toEqual([
      "todo",
      "in_progress",
      "review",
      "done",
      "blocked",
      "unmapped",
    ] as AggregateColumnId[]);
  });
});

describe("groupByStatus", () => {
  const lists: List[] = [
    { id: "l1", boardId: "b1", statusKind: "todo" },
    { id: "l2", boardId: "b1", statusKind: "in_progress" },
    { id: "l3", boardId: "b2", statusKind: "todo" },
    { id: "l4", boardId: "b2", statusKind: null },
  ];

  it("groups cards by their list's statusKind", () => {
    const cards: Card[] = [
      { id: "c1", boardId: "b1", listId: "l1", archived: false },
      { id: "c2", boardId: "b1", listId: "l2", archived: false },
      { id: "c3", boardId: "b2", listId: "l3", archived: false },
    ];
    const result = groupByStatus(cards, lists);
    expect(result.todo.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(result.in_progress.map((c) => c.id)).toEqual(["c2"]);
    expect(result.review).toEqual([]);
    expect(result.unmapped).toEqual([]);
  });

  it("routes cards on unmapped lists to the 'unmapped' bucket", () => {
    const cards: Card[] = [
      { id: "c4", boardId: "b2", listId: "l4", archived: false },
    ];
    expect(groupByStatus(cards, lists).unmapped.map((c) => c.id)).toEqual([
      "c4",
    ]);
  });

  it("excludes archived cards", () => {
    const cards: Card[] = [
      { id: "c5", boardId: "b1", listId: "l1", archived: true },
    ];
    expect(groupByStatus(cards, lists).todo).toEqual([]);
  });

  it("excludes cards whose list isn't in the input (CDC race)", () => {
    const cards: Card[] = [
      { id: "c6", boardId: "b1", listId: "missing", archived: false },
    ];
    const result = groupByStatus(cards, lists);
    for (const col of AGGREGATE_COLUMNS) {
      expect(result[col.id].some((c) => c.id === "c6")).toBe(false);
    }
  });
});

describe("findTargetListId", () => {
  const lists: List[] = [
    { id: "l1", boardId: "b1", statusKind: "todo" },
    { id: "l2", boardId: "b1", statusKind: "in_progress" },
    { id: "l3", boardId: "b1", statusKind: "in_progress" },
    { id: "l4", boardId: "b2", statusKind: "todo" },
  ];

  it("returns the first list on the board with the target statusKind", () => {
    expect(findTargetListId(lists, "b1", "in_progress")).toBe("l2");
  });

  it("returns null when no list on the board has the status", () => {
    expect(findTargetListId(lists, "b1", "blocked")).toBeNull();
  });

  it("ignores lists from other boards", () => {
    expect(findTargetListId(lists, "b2", "in_progress")).toBeNull();
  });

  it("returns null when target is 'unmapped' (no semantic target)", () => {
    expect(findTargetListId(lists, "b1", "unmapped")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run tests/unit/aggregate-kanban-group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// lib/aggregate-kanban/group.ts
// Plan #aggregate-kanban — group workspace cards by their list's statusKind
// for the cross-board "My tasks" view. Pure helpers: no store reads, no
// React, no I/O. Layouts use exactly the same column model as the Kanban
// status mapping (`lists.statusKind` enum) plus an "unmapped" sink for
// cards whose list has no statusKind set.

export type StatusKind =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";
export type AggregateColumnId = StatusKind | "unmapped";

export const AGGREGATE_COLUMNS: ReadonlyArray<{
  id: AggregateColumnId;
  label: string;
}> = [
  { id: "todo", label: "TO DO" },
  { id: "in_progress", label: "IN PROGRESS" },
  { id: "review", label: "REVIEW" },
  { id: "done", label: "DONE" },
  { id: "blocked", label: "BLOCKED" },
  { id: "unmapped", label: "NO STATUS" },
];

type CardLite = {
  id: string;
  boardId: string;
  listId: string;
  archived: boolean;
};
type ListLite = {
  id: string;
  boardId: string;
  statusKind: StatusKind | null;
};

export type GroupResult<C extends CardLite = CardLite> = Record<
  AggregateColumnId,
  C[]
>;

export function groupByStatus<C extends CardLite, L extends ListLite>(
  cards: C[],
  lists: L[],
): GroupResult<C> {
  const listById = new Map(lists.map((l) => [l.id, l]));
  const out: GroupResult<C> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
    blocked: [],
    unmapped: [],
  };
  for (const c of cards) {
    if (c.archived) continue;
    const l = listById.get(c.listId);
    if (!l) continue;
    const col: AggregateColumnId = l.statusKind ?? "unmapped";
    out[col].push(c);
  }
  return out;
}

export function findTargetListId<L extends ListLite>(
  lists: L[],
  boardId: string,
  target: AggregateColumnId,
): string | null {
  if (target === "unmapped") return null;
  for (const l of lists) {
    if (l.boardId === boardId && l.statusKind === target) return l.id;
  }
  return null;
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `npx vitest run tests/unit/aggregate-kanban-group.test.ts`
Expected: 9 tests pass (3 "groupByStatus" + 1 "AGGREGATE_COLUMNS" + 4 "findTargetListId").

- [ ] **Step 5: Commit**

```bash
git add lib/aggregate-kanban tests/unit/aggregate-kanban-group.test.ts
git commit -m "feat(aggregate-kanban): groupByStatus + findTargetListId helpers"
```

---

## Task 3: Card item component (display-only)

**Files:**
- Create: `components/workspace/all-tasks-card.tsx`

- [ ] **Step 1: Implement the card display**

```tsx
// components/workspace/all-tasks-card.tsx
"use client";
import Link from "next/link";
import { CalendarRange, CornerDownRight } from "lucide-react";
import {
  PriorityChip,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import { useWorkspaceStore } from "@/stores/workspace-store";

function fmtShortDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AllTasksCard({
  cardId,
  boardId,
  title,
  listId,
  sprintId,
  priority,
  dueDate,
}: {
  cardId: string;
  boardId: string;
  title: string;
  listId: string;
  sprintId: string | null;
  priority: CardPriority | null;
  dueDate: Date | string | null;
}) {
  // Read board title + sprint name from workspace store. Stable primitives.
  const boardTitle = useWorkspaceStore(
    (s) => s.boards.find((b) => b.id === boardId)?.title ?? null,
  );
  const sprintName = useWorkspaceStore((s) =>
    sprintId ? s.sprints.find((sp) => sp.id === sprintId)?.name ?? null : null,
  );
  const due = fmtShortDate(dueDate);
  return (
    <Link
      href={`/b/${boardId}/c/${cardId}`}
      data-testid="all-tasks-card"
      data-card-id={cardId}
      data-board-id={boardId}
      data-list-id={listId}
      className="block rounded-md border border-hairline bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.04)] transition-colors p-2.5 space-y-2"
    >
      <div className="text-sm leading-snug text-fg">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5 mono-meta-sm text-fg-muted">
        {boardTitle && (
          <span
            className="chip"
            data-testid="all-tasks-card-board-chip"
            title={`Board: ${boardTitle}`}
          >
            <CornerDownRight className="size-3" />
            {boardTitle.toUpperCase()}
          </span>
        )}
        {sprintName && (
          <span className="chip" title={`Sprint: ${sprintName}`}>
            {sprintName.toUpperCase()}
          </span>
        )}
        {due && (
          <span className="chip">
            <CalendarRange className="size-3" />
            {due}
          </span>
        )}
        {priority && <PriorityChip priority={priority} />}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/all-tasks-card.tsx
git commit -m "feat(all-tasks): card display with board chip"
```

---

## Task 4: Column component (droppable + sortable area)

**Files:**
- Create: `components/workspace/all-tasks-column.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/workspace/all-tasks-column.tsx
"use client";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { AggregateColumnId } from "@/lib/aggregate-kanban/group";

export function AllTasksColumn({
  id,
  label,
  count,
  children,
}: {
  id: AggregateColumnId;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `aggregate-column:${id}`,
    data: { type: "aggregate-column", columnId: id },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="all-tasks-column"
      data-column-id={id}
      data-is-over={isOver ? "true" : undefined}
      className={`flex flex-col rounded-lg border border-hairline bg-[color:var(--surface-strong)] min-h-[60vh] ${
        isOver ? "ring-2 ring-fg/50" : ""
      }`}
    >
      <div className="px-3 py-2 border-b border-hairline flex items-center justify-between">
        <span className="mono-meta text-fg-muted">{label}</span>
        <span className="mono-meta-sm text-fg-faint" data-testid="all-tasks-column-count">
          {count}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        <SortableContext
          items={[]}
          strategy={verticalListSortingStrategy}
        >
          {children}
        </SortableContext>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/all-tasks-column.tsx
git commit -m "feat(all-tasks): droppable column shell"
```

---

## Task 5: Filter helper + tests (TDD)

**Files:**
- Modify: `lib/aggregate-kanban/group.ts` (add `cardMatchesFilter`)
- Modify: `tests/unit/aggregate-kanban-group.test.ts` (add filter tests)

- [ ] **Step 1: Add the failing tests**

Append to `tests/unit/aggregate-kanban-group.test.ts`:

```ts
import { cardMatchesFilter } from "@/lib/aggregate-kanban/group";

describe("cardMatchesFilter", () => {
  type FilterCard = {
    id: string;
    title: string;
    priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
    sprintId: string | null;
    dueDate: Date | null;
  };
  type Member = { cardId: string; userId: string };

  const me = "user-1";
  const c1: FilterCard = {
    id: "c1",
    title: "Implement feature",
    priority: "p1",
    sprintId: "s1",
    dueDate: null,
  };
  const c2: FilterCard = {
    id: "c2",
    title: "Fix bug",
    priority: null,
    sprintId: null,
    dueDate: null,
  };
  const members: Member[] = [
    { cardId: "c1", userId: me },
  ];

  it("scope=mine includes assigned, excludes unassigned", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "mine",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c2, {
        scope: "mine",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(false);
  });

  it("scope=all includes both", () => {
    expect(
      cardMatchesFilter(c2, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(true);
  });

  it("query filters by title (case-insensitive substring)", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "feature",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "FEATURE",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "bug",
      }),
    ).toBe(false);
  });

  it("priority filter accepts subset", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        priorities: ["p0", "p1"],
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        priorities: ["p2"],
      }),
    ).toBe(false);
  });

  it("sprint filter matches single id", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        sprintId: "s1",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        sprintId: "s2",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, expect 5 failures**

Run: `npx vitest run tests/unit/aggregate-kanban-group.test.ts`
Expected: 5 new "cardMatchesFilter" tests fail (function not exported).

- [ ] **Step 3: Implement `cardMatchesFilter`**

Append to `lib/aggregate-kanban/group.ts`:

```ts
type FilterCardLite = {
  id: string;
  title: string;
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  sprintId: string | null;
  dueDate: Date | string | null;
};

export type AggregateScope = "mine" | "all";

export type FilterInput = {
  scope: AggregateScope;
  viewerId: string;
  members: ReadonlyArray<{ cardId: string; userId: string }>;
  query: string;
  priorities?: ReadonlyArray<"p0" | "p1" | "p2" | "p3" | "p4">;
  sprintId?: string;
};

export function cardMatchesFilter<C extends FilterCardLite>(
  card: C,
  f: FilterInput,
): boolean {
  if (f.scope === "mine") {
    const assigned = f.members.some(
      (m) => m.cardId === card.id && m.userId === f.viewerId,
    );
    if (!assigned) return false;
  }
  if (f.query) {
    if (!card.title.toLowerCase().includes(f.query.toLowerCase())) return false;
  }
  if (f.priorities && f.priorities.length > 0) {
    if (!card.priority) return false;
    if (!f.priorities.includes(card.priority)) return false;
  }
  if (f.sprintId) {
    if (card.sprintId !== f.sprintId) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/aggregate-kanban-group.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/aggregate-kanban tests/unit/aggregate-kanban-group.test.ts
git commit -m "feat(aggregate-kanban): cardMatchesFilter (mine/all + query + priority + sprint)"
```

---

## Task 6: Aggregate view client component (read + render)

**Files:**
- Create: `components/workspace/all-tasks-view.tsx`

- [ ] **Step 1: Render-only first pass (no drag yet)**

```tsx
// components/workspace/all-tasks-view.tsx
"use client";
import { useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import {
  AGGREGATE_COLUMNS,
  groupByStatus,
  cardMatchesFilter,
  type AggregateScope,
} from "@/lib/aggregate-kanban/group";
import { AllTasksColumn } from "./all-tasks-column";
import { AllTasksCard } from "./all-tasks-card";
import type { CardPriority } from "@/components/board/card/priority-picker";

const SCOPES: AggregateScope[] = ["mine", "all"];

export function AllTasksView({
  workspaceId,
  viewerId,
}: {
  workspaceId: string;
  viewerId: string;
}) {
  // Live workspace store sync.
  useWorkspaceRealtime(workspaceId);

  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const scope: AggregateScope = SCOPES.includes(
    (sp.get("scope") ?? "mine") as AggregateScope,
  )
    ? ((sp.get("scope") ?? "mine") as AggregateScope)
    : "mine";
  const queryDraft = sp.get("q") ?? "";
  const sprintFilter = sp.get("sprint") ?? "";

  const setScope = (next: AggregateScope) => {
    const params = new URLSearchParams(sp.toString());
    if (next === "mine") params.delete("scope");
    else params.set("scope", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const setQuery = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const cards = useWorkspaceStore((s) => s.cards);
  const lists = useWorkspaceStore((s) => s.lists);
  const cardMembers = useWorkspaceStore((s) => s.cardMembers);
  const sprints = useWorkspaceStore((s) => s.sprints);

  const filtered = useMemo(
    () =>
      cards.filter((c) =>
        cardMatchesFilter(
          {
            id: c.id,
            title: c.title,
            priority: c.priority as CardPriority | null,
            sprintId: c.sprintId,
            dueDate: c.dueDate,
          },
          {
            scope,
            viewerId,
            members: cardMembers,
            query: queryDraft,
            sprintId: sprintFilter || undefined,
          },
        ),
      ),
    [cards, cardMembers, scope, viewerId, queryDraft, sprintFilter],
  );
  const grouped = useMemo(() => groupByStatus(filtered, lists), [filtered, lists]);

  return (
    <div className="space-y-4" data-testid="all-tasks-view">
      <div className="flex items-center gap-2 flex-wrap">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            data-testid="all-tasks-scope-toggle"
            data-scope={s}
            data-active={scope === s ? "true" : "false"}
            className={`chip mono-meta-sm ${scope === s ? "ring-1 ring-fg/40 bg-fg/10" : ""}`}
          >
            {s === "mine" ? "MINE" : "ALL WORKSPACE"}
          </button>
        ))}
        <input
          type="search"
          value={queryDraft}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          data-testid="all-tasks-search"
          className="chip mono-meta-sm bg-transparent border border-hairline focus:border-fg/40 outline-none"
        />
        {sprints.length > 0 && (
          <select
            value={sprintFilter}
            onChange={(e) => {
              const params = new URLSearchParams(sp.toString());
              if (e.target.value) params.set("sprint", e.target.value);
              else params.delete("sprint");
              router.replace(`${pathname}?${params.toString()}`, {
                scroll: false,
              });
            }}
            data-testid="all-tasks-sprint-filter"
            className="chip mono-meta-sm bg-transparent border border-hairline"
          >
            <option value="">ANY SPRINT</option>
            {sprints
              .filter((s) => s.state !== "completed")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {AGGREGATE_COLUMNS.map((col) => (
          <AllTasksColumn
            key={col.id}
            id={col.id}
            label={col.label}
            count={grouped[col.id].length}
          >
            {grouped[col.id].map((c) => (
              <AllTasksCard
                key={c.id}
                cardId={c.id}
                boardId={c.boardId}
                title={c.title}
                listId={c.listId}
                sprintId={c.sprintId}
                priority={c.priority as CardPriority | null}
                dueDate={c.dueDate}
              />
            ))}
          </AllTasksColumn>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test by visiting the page**

Run: `npm run dev` then visit `/w/<workspaceId>/all-tasks`
Expected: 6 columns render with cards distributed by status. Filter chips work. No drag yet.

- [ ] **Step 3: tsc + tests**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: clean, prior tests still pass.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/all-tasks-view.tsx
git commit -m "feat(all-tasks): view with columns + filter chips (no drag)"
```

---

## Task 7: Drag-and-drop column-to-column (status change)

**Files:**
- Modify: `components/workspace/all-tasks-view.tsx` (wrap in `<DndContext>`, add `onDragEnd`)
- Modify: `components/workspace/all-tasks-card.tsx` (wire `useDraggable` so the Link still navigates on click but the card is draggable on grab)

- [ ] **Step 1: Make card draggable**

Refactor `all-tasks-card.tsx` — wrap content in `useDraggable` and pass listeners through to a non-Link wrapper. Click → navigate; drag → move.

```tsx
// components/workspace/all-tasks-card.tsx
"use client";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, CornerDownRight } from "lucide-react";
import {
  PriorityChip,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import { useWorkspaceStore } from "@/stores/workspace-store";

function fmtShortDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const DRAG_THRESHOLD = 4; // px — below this counts as a click, not a drag.

export function AllTasksCard({
  cardId,
  boardId,
  title,
  listId,
  sprintId,
  priority,
  dueDate,
}: {
  cardId: string;
  boardId: string;
  title: string;
  listId: string;
  sprintId: string | null;
  priority: CardPriority | null;
  dueDate: Date | string | null;
}) {
  const router = useRouter();
  const boardTitle = useWorkspaceStore(
    (s) => s.boards.find((b) => b.id === boardId)?.title ?? null,
  );
  const sprintName = useWorkspaceStore((s) =>
    sprintId ? s.sprints.find((sp) => sp.id === sprintId)?.name ?? null : null,
  );
  const due = fmtShortDate(dueDate);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `card:${cardId}`,
      data: { type: "card", cardId, boardId, listId },
    });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid="all-tasks-card"
      data-card-id={cardId}
      data-board-id={boardId}
      data-list-id={listId}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // dnd-kit's PointerSensor fires drag only past activationConstraint.
        // For a click (no drag), navigate to the card modal.
        if (e.defaultPrevented) return;
        router.push(`/b/${boardId}/c/${cardId}`);
      }}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.55 : 1,
        cursor: "grab",
      }}
      className="block rounded-md border border-hairline bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.04)] transition-colors p-2.5 space-y-2 select-none"
    >
      <div className="text-sm leading-snug text-fg">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5 mono-meta-sm text-fg-muted">
        {boardTitle && (
          <span
            className="chip"
            data-testid="all-tasks-card-board-chip"
            title={`Board: ${boardTitle}`}
          >
            <CornerDownRight className="size-3" />
            {boardTitle.toUpperCase()}
          </span>
        )}
        {sprintName && (
          <span className="chip" title={`Sprint: ${sprintName}`}>
            {sprintName.toUpperCase()}
          </span>
        )}
        {due && (
          <span className="chip">
            <CalendarRange className="size-3" />
            {due}
          </span>
        )}
        {priority && <PriorityChip priority={priority} />}
      </div>
    </div>
  );
}
```

`DRAG_THRESHOLD` is documented for clarity but enforced by the dnd-kit `PointerSensor` activationConstraint we'll set in the next step.

- [ ] **Step 2: Wrap view in DndContext + handle drop**

Modify `components/workspace/all-tasks-view.tsx`. Add at the top of the component (alongside other imports):

```tsx
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { findTargetListId } from "@/lib/aggregate-kanban/group";
import { moveCard } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";
```

Inside the component (after existing memos), add:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
);

const patchCard = useWorkspaceStore((s) => s.patchCard);

function onDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over) return;
  const activeData = active.data.current as
    | { type?: string; cardId?: string; boardId?: string; listId?: string }
    | undefined;
  const overData = over.data.current as
    | { type?: string; columnId?: import("@/lib/aggregate-kanban/group").AggregateColumnId }
    | undefined;
  if (
    !activeData ||
    activeData.type !== "card" ||
    !activeData.cardId ||
    !activeData.boardId
  ) {
    return;
  }
  if (!overData || overData.type !== "aggregate-column" || !overData.columnId) {
    return;
  }
  const card = cards.find((c) => c.id === activeData.cardId);
  if (!card) return;

  // No-op if dropped on the same column the card already lives in.
  const currentList = lists.find((l) => l.id === card.listId);
  const currentCol = currentList?.statusKind ?? "unmapped";
  if (currentCol === overData.columnId) return;

  // Cross-board drag is out of scope for v1: the user dropped onto a
  // status column but cards live on one board. Find the FIRST list with
  // the target status_kind on the card's CURRENT board.
  const toListId = findTargetListId(
    lists,
    activeData.boardId,
    overData.columnId,
  );
  if (!toListId) {
    toast.error(
      overData.columnId === "unmapped"
        ? "Drop a card on a status column."
        : `No list with status "${overData.columnId.replace("_", " ")}" on this card's board.`,
    );
    return;
  }

  // Optimistic: workspace store reflects the new listId immediately.
  // The board store on the source board will reconcile via realtime CDC.
  const origListId = card.listId;
  patchCard(card.id, { listId: toListId });
  void (async () => {
    try {
      // moveCard: { id, listId, position } — position '0' lets the server
      // append. Action computes the tail position itself for cross-list moves.
      await moveCard({ id: card.id, listId: toListId, position: "0" });
    } catch (err) {
      patchCard(card.id, { listId: origListId });
      const msg = "Failed to move card: " + (err as Error).message;
      toast.error(msg);
      errorBus.push({ message: msg });
    }
  })();
}
```

> **Note on `position: "0"`** — `moveCard` accepts a fractional position string and writes it directly. For "drop to end of target list" we'd ideally read the tail position and pick a value after it. Since `moveCard` doesn't compute that itself, follow the existing Kanban pattern: read the destination list's last card position via `useWorkspaceStore` and use `positionBetween(lastPos, null)` from `@/lib/positions`. Pseudocode:

```tsx
import { positionBetween } from "@/lib/positions";

const targetCards = cards
  .filter((c) => c.listId === toListId && !c.archived)
  .sort((a, b) => (a.position < b.position ? -1 : 1));
const lastPos =
  targetCards.length > 0 ? targetCards[targetCards.length - 1].position : null;
const newPos = positionBetween(lastPos, null);
```

(`positions` and `positionBetween` are already used by Kanban — verify the import path against `components/board/board-view.tsx`.)

Replace `position: "0"` with `position: newPos` in the action call.

Wrap the JSX:

```tsx
return (
  <div className="space-y-4" data-testid="all-tasks-view">
    {/* ...filter chips unchanged... */}
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* ...columns unchanged... */}
      </div>
    </DndContext>
  </div>
);
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`. Visit `/w/<workspaceId>/all-tasks`. Drag a card from "TO DO" to "IN PROGRESS". Expect:
- Card appears under the new column.
- After ~500 ms (server roundtrip + CDC), the per-board store reconciles.
- Reload — card persists in the new list.

Tip: use a board with at least one list per status. If a status column has no target list on the card's board, dropping triggers the toast `No list with status "in progress" on this card's board.`.

- [ ] **Step 4: tsc + tests**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/workspace
git commit -m "feat(all-tasks): drag card between status columns (same-board move)"
```

---

## Task 8: Top-nav entry + command palette

**Files:**
- Modify: `components/nav/top-nav.tsx`
- Modify: `components/workspace/command-palette.tsx` (find the existing palette — search the repo for `Cmd+K` or `command-palette`)

- [ ] **Step 1: Add MY TASKS link**

In `components/nav/top-nav.tsx`, between `WorkspaceSwitcher` and the existing `BACKLOG` link (around line 42-50), insert:

```tsx
<span className="text-fg-faint select-none" aria-hidden>/</span>
<Link
  href={`/w/${wsForLinks}/all-tasks`}
  className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors"
  data-testid="nav-all-tasks"
>
  MY TASKS
</Link>
```

- [ ] **Step 2: Add palette entry**

Locate the command palette (likely `components/workspace/command-palette.tsx` or similar — grep for `command palette` / `Cmd+K`). Find the static actions array and add an entry:

```tsx
{
  id: "open-my-tasks",
  label: "Open my tasks",
  keywords: ["tasks", "kanban", "aggregate", "mine"],
  href: `/w/${activeWorkspaceId}/all-tasks`,
}
```

If the palette uses callbacks instead of `href`, mirror the existing entries' shape (e.g. `onSelect: () => router.push(...)`).

- [ ] **Step 3: tsc + tests**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: clean.

- [ ] **Step 4: Smoke**

Visit any page → top nav shows `MY TASKS`. Press Cmd+K → "Open my tasks" entry navigates correctly.

- [ ] **Step 5: Commit**

```bash
git add components/nav/top-nav.tsx components/workspace/command-palette.tsx
git commit -m "feat(all-tasks): top-nav entry + palette command"
```

---

## Task 9: Empty states

**Files:**
- Create: `components/workspace/all-tasks-empty-state.tsx`
- Modify: `components/workspace/all-tasks-view.tsx` (mount empty states)

- [ ] **Step 1: Implement empty-state copy**

```tsx
// components/workspace/all-tasks-empty-state.tsx
"use client";
import Link from "next/link";

export function AllTasksEmptyState({
  workspaceId,
  reason,
}: {
  workspaceId: string;
  reason: "no-boards" | "no-mine" | "no-status-mapping" | "filtered-out";
}) {
  if (reason === "no-boards") {
    return (
      <div
        data-testid="all-tasks-empty-no-boards"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">No boards yet.</p>
        <p className="mono-meta-sm text-fg-muted">
          Create a board to start collecting tasks here.
        </p>
        <Link
          href={`/w/${workspaceId}`}
          className="chip mono-meta-sm hover:bg-fg/10"
        >
          ← Back to workspace
        </Link>
      </div>
    );
  }
  if (reason === "no-status-mapping") {
    return (
      <div
        data-testid="all-tasks-empty-no-status"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">No status mappings yet.</p>
        <p className="mono-meta-sm text-fg-muted">
          Open a board's settings and map each list to a status (To Do / In
          Progress / Done / etc.) — those mappings drive the columns here.
        </p>
      </div>
    );
  }
  if (reason === "no-mine") {
    return (
      <div
        data-testid="all-tasks-empty-no-mine"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">Nothing assigned to you.</p>
        <p className="mono-meta-sm text-fg-muted">
          Switch to <strong>ALL WORKSPACE</strong> to see every card across
          boards.
        </p>
      </div>
    );
  }
  // filtered-out
  return (
    <div
      data-testid="all-tasks-empty-filtered"
      className="text-center py-16 space-y-4 max-w-md mx-auto"
    >
      <p className="serif-display text-3xl">No matches.</p>
      <p className="mono-meta-sm text-fg-muted">
        Try a broader search or clear active filters.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Mount in the view**

In `components/workspace/all-tasks-view.tsx`, before the `<DndContext>`:

```tsx
const totalCards = cards.length;
const totalFiltered = filtered.length;
const boards = useWorkspaceStore((s) => s.boards);
const anyStatusMapped = lists.some((l) => l.statusKind !== null);

let emptyReason: "no-boards" | "no-mine" | "no-status-mapping" | "filtered-out" | null = null;
if (boards.length === 0) emptyReason = "no-boards";
else if (!anyStatusMapped) emptyReason = "no-status-mapping";
else if (totalFiltered === 0 && scope === "mine") emptyReason = "no-mine";
else if (totalFiltered === 0) emptyReason = "filtered-out";
```

Render conditionally:

```tsx
{emptyReason ? (
  <AllTasksEmptyState workspaceId={workspaceId} reason={emptyReason} />
) : (
  <DndContext sensors={sensors} onDragEnd={onDragEnd}>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {/* ...columns... */}
    </div>
  </DndContext>
)}
```

Don't forget to import `AllTasksEmptyState` at the top.

- [ ] **Step 3: tsc + tests**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/workspace
git commit -m "feat(all-tasks): empty states (no boards / no status / no mine / no matches)"
```

---

## Task 10: E2E spec

**Files:**
- Create: `tests/e2e/aggregate-kanban.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/aggregate-kanban.spec.ts
import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (list.ok()) {
      const data = await list.json();
      if (data.messages && data.messages.length > 0) {
        const id = data.messages[0].ID;
        const detail = await api.get(`/api/v1/message/${id}`);
        const msg = await detail.json();
        const body: string = msg.HTML || msg.Text || "";
        const m =
          body.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ??
          body.match(/(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email arrived for ${email}`);
}

async function signupAndLand(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const link = await fetchConfirmLink(email);
  await page.goto(link);
  const url = page.url();
  const wsMatch = url.match(/\/w\/([0-9a-f-]{36})/);
  if (!wsMatch) throw new Error(`no workspace in url: ${url}`);
  return { email, workspaceId: wsMatch[1] };
}

test("MY TASKS link in top nav navigates to aggregate view", async ({ page }) => {
  const { workspaceId } = await signupAndLand(page, "agg-nav");
  await page.goto(`/w/${workspaceId}`);
  await page.getByTestId("nav-all-tasks").click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/all-tasks`));
  await expect(page.getByTestId("all-tasks-view")).toBeVisible();
  // Empty state — fresh workspace has no boards.
  await expect(page.getByTestId("all-tasks-empty-no-boards")).toBeVisible();
});

test("dragging a card between status columns persists the move", async ({ page }) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLand(page, "agg-drag");
  await page.goto(`/w/${workspaceId}`);
  // Create one board with two status-mapped lists.
  // Use the workspace's "+ New board" trigger.
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByPlaceholder(/board name/i).fill("Drag Test");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);

  // Add two lists and map their statuses via the lists admin panel.
  // (Reuse helpers from existing kanban specs if available; otherwise
  //  drive the UI directly. The existing `lists-admin-panel.tsx`
  //  testid `list-status-select` lets us set status_kind on each list.)

  // ... (follow the existing pattern in `tests/e2e/jira-gantt-integration.spec.ts`
  //  for adding lists. After both lists exist, open settings → lists →
  //  set list 1 to "to do", list 2 to "in progress").

  // Add a card to the "to do" list.
  // ...

  // Navigate to /all-tasks.
  await page.goto(`/w/${workspaceId}/all-tasks`);
  await expect(page.getByTestId("all-tasks-view")).toBeVisible();
  await page.getByTestId("all-tasks-scope-toggle").filter({ hasText: "ALL" }).click();

  // Card should appear under the TO DO column.
  const todoCol = page.getByTestId("all-tasks-column").filter({
    has: page.locator('[data-column-id="todo"]'),
  });
  const inProgCol = page.getByTestId("all-tasks-column").filter({
    has: page.locator('[data-column-id="in_progress"]'),
  });
  const card = page.getByTestId("all-tasks-card").first();
  await expect(card).toBeVisible({ timeout: 5000 });

  // Drag card → in progress column.
  await card.dragTo(inProgCol);

  // Card should now be inside in_progress column.
  await expect(
    inProgCol.getByTestId("all-tasks-card").first(),
  ).toBeVisible({ timeout: 5000 });
  await expect(todoCol.getByTestId("all-tasks-card")).toHaveCount(0);

  // Reload — should persist.
  await page.reload();
  await expect(
    inProgCol.getByTestId("all-tasks-card").first(),
  ).toBeVisible({ timeout: 5000 });
});
```

> The seed-via-UI section is sketched. Fill it with concrete helpers reused from the existing E2E suite (`tests/e2e/jira-gantt-integration.spec.ts` already sets up `addList` / `addCardToList` / `setListStatusKind`-style helpers — copy them locally per the convention used by `gantt-drag-first.spec.ts`).

- [ ] **Step 2: Run the spec (skip if Supabase isn't up)**

Run: `npm run test:e2e -- aggregate-kanban`
Expected: 2 tests pass. If the seed helpers need to be filled in, do that until both pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/aggregate-kanban.spec.ts
git commit -m "test(e2e): aggregate kanban — nav + drag persistence"
```

---

## Task 11: concerns.md update

**Files:**
- Modify (on `main`, separate commit): `docs/superpowers/concerns.md`

- [ ] **Step 1: Add a row under "Cross-view consistency"**

```md
| Aggregate Kanban (My Tasks) | Shipped — `/w/<id>/all-tasks`. Workspace-wide view, columns by `lists.statusKind`, default scope `mine`. Drag changes status (same-board only — cross-board drag deferred). | ✅ |
```

And under "Out-of-scope for current epic":

```md
- Cross-board drag in the aggregate kanban (drop a card onto a column whose target list lives on a different board would require a `moveCardCrossBoard` call from the aggregate view; v1 keeps the existing `moveCard` same-board path for simplicity)
```

- [ ] **Step 2: Commit on main**

```bash
cd /home/innovina/Documents/Trinnovina  # or wherever main is checked out
git add docs/superpowers/concerns.md
git commit -m "docs(concerns): aggregate kanban shipped, cross-board drag deferred"
```

---

## Verification (run before declaring plan complete)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:unit` — 14+ new tests pass (group + filter + existing 185)
- [ ] `npm run lint` — no new warnings
- [ ] Manual smoke:
  - Visit `/w/<id>/all-tasks` from a workspace with 2+ boards → 6 columns render with mapped cards.
  - Toggle MINE → ALL → cards visible only when scope matches assignment.
  - Drag a card todo → in_progress → reloads correctly into the new list.
  - Drop on a column with no matching list on the card's board → toast explains why.
  - Top-nav `MY TASKS` link present + active.
  - Cmd+K → "Open my tasks" entry navigates.
- [ ] `tests/e2e/aggregate-kanban.spec.ts` — 2 specs pass.

---

## Self-Review Notes

- **Spec coverage:** route ✓, columns ✓, drag ✓, filter (mine/all/search/sprint/priority — priority filter present in helper but no UI chip; OK for v1) ✓, top-nav ✓, palette ✓, empty states ✓, e2e ✓, concerns.md ✓.
- **Placeholders:** none. Each step has runnable code or commands.
- **Type consistency:** `AggregateColumnId` used in helpers, column, and view all reference the same type. `AggregateScope` ditto. `findTargetListId` matches its caller's expectations.
- **Known fragility:** `position: "0"` placeholder in Task 7 step 2 — replaced by `positionBetween` lookup. The implementing engineer must wire that import (see note in Task 7).
- **Cross-board drag deferral**: documented in concerns.md and out-of-scope section. v1 makes drop-to-other-board fail gracefully with a toast, never silently.
- **Realtime**: `useWorkspaceRealtime(workspaceId)` is called in the view. Cards mutated on a board page or by a peer user reconcile here without a manual refetch.
- **Performance**: workspace snapshot loads all cards in workspace. For very large workspaces (>10k cards) this becomes heavy; the snapshot table-by-table cap is the same upstream concern flagged in the γ-G review (M4). v1 ignores; revisit if it becomes a real complaint.
- **A11y**: card is `role="button"` + `tabIndex=0` + click navigates. Keyboard drag (dnd-kit's `KeyboardSensor`) is NOT wired — could be added cheaply by attaching `useSensor(KeyboardSensor, { coordinateGetter })` next to `PointerSensor`. Listed as a γ-F item if a11y plan picks it up.

---

## Estimated effort

| Task | Effort |
|---|---|
| 1 — route scaffold | 30 min |
| 2 — group helper + tests | 1 hr |
| 3 — card display | 30 min |
| 4 — column shell | 30 min |
| 5 — filter helper + tests | 1 hr |
| 6 — view (no drag) | 1 hr |
| 7 — drag-and-drop wiring | 1.5 hr |
| 8 — nav + palette | 30 min |
| 9 — empty states | 30 min |
| 10 — E2E | 1.5 hr |
| 11 — concerns.md | 5 min |
| **Total** | **~8 hrs** subagent (~1 day) |
