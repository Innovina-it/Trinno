# Plan #16b-β — Workspace Store + Gantt Sync (Refactor Slice)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Refactor the cross-view data layer so the Roadmap, Backlog, and Dashboards stop being islands. Introduce a per-workspace Zustand store fed by a single Supabase realtime channel; the existing per-board store stays for board-only views (Kanban). Add subtask expansion + sprint overlay + suggestion when sprint dates conflict + new dashboard gadget.

**Architecture summary:**
- **Per-board store** (`stores/board-store.ts`) — unchanged. Used by Kanban/board view + per-card sections.
- **Per-workspace store** (NEW `stores/workspace-store.ts`) — used by Roadmap + Backlog + Dashboards (when bound to a workspace). Snapshot loader fetches all cards across all readable boards in the workspace + sprints + components + versions + boardProfiles.
- **Realtime hook** (NEW `hooks/use-workspace-realtime.ts`) — single channel `ws:{id}` subscribed to `cards`, `sprints`, `card_links`, `versions`, `card_versions` filtered by workspace. The board-level realtime hook continues to handle list/label/checklist/comment/etc updates inside an open board.
- **`RoadmapView` refactor** — drop local `cards`/`links` props, read from `useWorkspaceStore` selectors. Drag-end calls `updateCard()` (already does); CDC echo flows back through the workspace store.
- **Subtask rendering** — expand carets on parent rows; layout helper extends to nest children.
- **Sprint overlay** — translucent vertical bands aligned to grid.
- **Move-dates-with-sprint** — when starting a sprint, scan cards in the sprint with `target_date < sprint.endDate || start_date > sprint.endDate`; offer a single batched action.
- **Dashboard gadget `on_roadmap`** — counts of scheduled / unscheduled / overdue cards in workspace.

**Out of scope (β only):**
- Activity-log triggers for `start_date`/`target_date` (slice α).
- Tile-side schedule chips, cross-view nav links (slice α).
- Critical path / cascade reschedule / list-status mapping (slice γ).

---

## Files

### NEW
- `stores/workspace-store.ts`
- `lib/queries/workspace-snapshot.ts`
- `hooks/use-workspace-realtime.ts`
- `components/workspace/workspace-store-provider.tsx`
- `components/roadmap/sprint-overlay.tsx`
- `components/dashboard/gadgets/gadget-on-roadmap.tsx`
- `components/sprint/sprint-date-conflict-dialog.tsx`
- `tests/integration/workspace-snapshot.test.ts` (or `tests/unit/workspace-store.test.ts` if pure)
- `tests/integration/start-sprint-conflict.test.ts`

### MODIFIED
- `components/roadmap/roadmap-view.tsx` — read from workspace store; render sprint overlay; render subtask child rows.
- `lib/roadmap/layout.ts` — extend `groupByEpic`/`stackInLane` for subtask nesting.
- `lib/queries/roadmap.ts` — keep server-side fetch path (initial paint), but allow including subtasks (drop `IS NOT NULL` filter on subtasks; client decides whether to render).
- `app/(app)/w/[wsId]/roadmap/page.tsx` — wrap in `<WorkspaceStoreProvider>` with snapshot.
- `app/(app)/w/[wsId]/backlog/page.tsx` — same provider; backlog list reads from store.
- `app/(app)/dashboards/[dashboardId]/page.tsx` — provider when dashboard has `workspaceId`; otherwise no-op.
- `actions/sprints.ts` `startSprintImpl` — return list of date-conflict cards along with started sprint.
- `lib/dashboards/resolvers.ts` — append `resolveOnRoadmap`.
- `components/dashboard/add-gadget-dialog.tsx` — add "On roadmap" type option.
- `lib/validation.ts` — add `on_roadmap` to `GadgetType` enum.

---

## Task 1 — Workspace snapshot query

**File:** `lib/queries/workspace-snapshot.ts`

```ts
import { eq, and, inArray, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  boards, cards, sprints, components, versions,
  cardComponents, cardVersions, cardLinks, profiles, boardMembers, workspaceMembers,
} from "@/lib/db/schema";

export type WorkspaceSnapshot = {
  workspaceId: string;
  boards: Array<{
    id: string; title: string; archived: boolean;
    backgroundKind: string; backgroundValue: string;
  }>;
  cards: Array<{
    id: string; boardId: string; listId: string;
    title: string; description: string | null;
    type: string; parentCardId: string | null;
    sprintId: string | null;
    storyPoints: number | null;
    startDate: Date | null; targetDate: Date | null;
    dueDate: Date | null; dueComplete: boolean;
    archived: boolean; createdAt: Date;
  }>;
  sprints: Array<{
    id: string; name: string; goal: string | null;
    startDate: Date; endDate: Date; state: string;
  }>;
  components: Array<{ id: string; boardId: string; name: string }>;
  cardComponents: Array<{ cardId: string; componentId: string }>;
  versions: Array<{
    id: string; name: string; semver: string | null;
    state: string; releaseDate: Date | null;
  }>;
  cardVersions: Array<{ cardId: string; versionId: string; kind: string }>;
  cardLinks: Array<{
    id: string; fromCardId: string; toCardId: string;
    kind: string; boardId: string;
  }>;
  workspaceProfiles: Array<{ id: string; displayName: string }>;
};

export async function getWorkspaceSnapshot(
  token: string, workspaceId: string,
): Promise<WorkspaceSnapshot | null> {
  return dbAsUser(token, async (tx) => {
    const boardRows = await tx
      .select({
        id: boards.id, title: boards.title, archived: boards.archived,
        backgroundKind: boards.backgroundKind, backgroundValue: boards.backgroundValue,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId));
    if (boardRows.length === 0) {
      return {
        workspaceId,
        boards: [], cards: [], sprints: [],
        components: [], cardComponents: [],
        versions: [], cardVersions: [],
        cardLinks: [], workspaceProfiles: [],
      };
    }
    const boardIds = boardRows.map((b) => b.id);

    const [
      cardRows, sprintRows, componentRows, cardComponentRows,
      versionRows, cardVersionRows, cardLinkRows, memberRows,
    ] = await Promise.all([
      tx.select({
        id: cards.id, boardId: cards.boardId, listId: cards.listId,
        title: cards.title, description: cards.description,
        type: cards.type, parentCardId: cards.parentCardId,
        sprintId: cards.sprintId, storyPoints: cards.storyPoints,
        startDate: cards.startDate, targetDate: cards.targetDate,
        dueDate: cards.dueDate, dueComplete: cards.dueComplete,
        archived: cards.archived, createdAt: cards.createdAt,
      }).from(cards).where(inArray(cards.boardId, boardIds)),

      tx.select({
        id: sprints.id, name: sprints.name, goal: sprints.goal,
        startDate: sprints.startDate, endDate: sprints.endDate, state: sprints.state,
      }).from(sprints).where(eq(sprints.workspaceId, workspaceId)).orderBy(asc(sprints.startDate)),

      tx.select({ id: components.id, boardId: components.boardId, name: components.name })
        .from(components).where(inArray(components.boardId, boardIds)),

      tx.select({ cardId: cardComponents.cardId, componentId: cardComponents.componentId })
        .from(cardComponents).where(inArray(cardComponents.boardId, boardIds)),

      tx.select({
        id: versions.id, name: versions.name, semver: versions.semver,
        state: versions.state, releaseDate: versions.releaseDate,
      }).from(versions).where(eq(versions.workspaceId, workspaceId)).orderBy(asc(versions.name)),

      tx.select({ cardId: cardVersions.cardId, versionId: cardVersions.versionId, kind: cardVersions.kind })
        .from(cardVersions).where(eq(cardVersions.workspaceId, workspaceId)),

      tx.select({
        id: cardLinks.id, fromCardId: cardLinks.fromCardId, toCardId: cardLinks.toCardId,
        kind: cardLinks.kind, boardId: cardLinks.boardId,
      }).from(cardLinks).where(inArray(cardLinks.boardId, boardIds)),

      tx.select({ userId: workspaceMembers.userId })
        .from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)),
    ]);

    const profileRows = memberRows.length === 0 ? [] : await tx
      .select({ id: profiles.id, displayName: profiles.displayName })
      .from(profiles).where(inArray(profiles.id, memberRows.map((m) => m.userId)));

    return {
      workspaceId,
      boards: boardRows,
      cards: cardRows,
      sprints: sprintRows,
      components: componentRows,
      cardComponents: cardComponentRows,
      versions: versionRows,
      cardVersions: cardVersionRows,
      cardLinks: cardLinkRows,
      workspaceProfiles: profileRows,
    };
  });
}
```

Commit: `feat(queries): getWorkspaceSnapshot — cards/sprints/components/versions/links across all readable boards`

---

## Task 2 — Workspace store

**File:** `stores/workspace-store.ts`

```ts
"use client";
import { createStore, useStore } from "zustand";
import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

type Card = WorkspaceSnapshot["cards"][number];
type Sprint = WorkspaceSnapshot["sprints"][number];
type Component = WorkspaceSnapshot["components"][number];
type CardComponent = WorkspaceSnapshot["cardComponents"][number];
type Version = WorkspaceSnapshot["versions"][number];
type CardVersion = WorkspaceSnapshot["cardVersions"][number];
type CardLink = WorkspaceSnapshot["cardLinks"][number];
type Profile = WorkspaceSnapshot["workspaceProfiles"][number];
type Board = WorkspaceSnapshot["boards"][number];

export type WorkspaceState = {
  workspaceId: string;
  boards: Board[];
  cards: Card[];
  sprints: Sprint[];
  components: Component[];
  cardComponents: CardComponent[];
  versions: Version[];
  cardVersions: CardVersion[];
  cardLinks: CardLink[];
  workspaceProfiles: Profile[];

  setSnapshot: (s: Omit<WorkspaceSnapshot, "workspaceId">) => void;

  upsertCard: (c: Card) => void;
  patchCard: (id: string, patch: Partial<Card>) => void;
  removeCard: (id: string) => void;

  upsertSprint: (s: Sprint) => void;
  patchSprint: (id: string, patch: Partial<Sprint>) => void;
  removeSprint: (id: string) => void;

  upsertVersion: (v: Version) => void;
  patchVersion: (id: string, patch: Partial<Version>) => void;
  removeVersion: (id: string) => void;

  upsertCardLink: (l: CardLink) => void;
  removeCardLink: (id: string) => void;

  upsertCardVersion: (x: CardVersion) => void;
  removeCardVersion: (cardId: string, versionId: string, kind: string) => void;
};

export function createWorkspaceStore(initial: WorkspaceSnapshot) {
  return createStore<WorkspaceState>((set) => ({
    workspaceId: initial.workspaceId,
    boards: initial.boards,
    cards: initial.cards,
    sprints: initial.sprints,
    components: initial.components,
    cardComponents: initial.cardComponents,
    versions: initial.versions,
    cardVersions: initial.cardVersions,
    cardLinks: initial.cardLinks,
    workspaceProfiles: initial.workspaceProfiles,

    setSnapshot: (s) => set({ ...s }),

    upsertCard: (c) => set((st) => ({
      cards: st.cards.some((x) => x.id === c.id)
        ? st.cards.map((x) => (x.id === c.id ? { ...x, ...c } : x))
        : [...st.cards, c],
    })),
    patchCard: (id, patch) => set((st) => ({
      cards: st.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
    removeCard: (id) => set((st) => ({ cards: st.cards.filter((c) => c.id !== id) })),

    upsertSprint: (s) => set((st) => ({
      sprints: st.sprints.some((x) => x.id === s.id)
        ? st.sprints.map((x) => (x.id === s.id ? { ...x, ...s } : x))
        : [...st.sprints, s],
    })),
    patchSprint: (id, patch) => set((st) => ({
      sprints: st.sprints.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),
    removeSprint: (id) => set((st) => ({ sprints: st.sprints.filter((s) => s.id !== id) })),

    upsertVersion: (v) => set((st) => ({
      versions: st.versions.some((x) => x.id === v.id)
        ? st.versions.map((x) => (x.id === v.id ? { ...x, ...v } : x))
        : [...st.versions, v],
    })),
    patchVersion: (id, patch) => set((st) => ({
      versions: st.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    })),
    removeVersion: (id) => set((st) => ({ versions: st.versions.filter((v) => v.id !== id) })),

    upsertCardLink: (l) => set((st) => ({
      cardLinks: st.cardLinks.some((x) => x.id === l.id)
        ? st.cardLinks
        : [...st.cardLinks, l],
    })),
    removeCardLink: (id) => set((st) => ({ cardLinks: st.cardLinks.filter((l) => l.id !== id) })),

    upsertCardVersion: (x) => set((st) => ({
      cardVersions: st.cardVersions.some(
        (cv) => cv.cardId === x.cardId && cv.versionId === x.versionId && cv.kind === x.kind,
      )
        ? st.cardVersions
        : [...st.cardVersions, x],
    })),
    removeCardVersion: (cardId, versionId, kind) => set((st) => ({
      cardVersions: st.cardVersions.filter(
        (cv) => !(cv.cardId === cardId && cv.versionId === versionId && cv.kind === kind),
      ),
    })),
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceStoreProvider({
  initial, children,
}: { initial: WorkspaceSnapshot; children: ReactNode }) {
  const ref = useRef<WorkspaceStore | null>(null);
  if (!ref.current) ref.current = createWorkspaceStore(initial);
  return createElement(WorkspaceStoreContext.Provider, { value: ref.current }, children);
}

export function useWorkspaceStore<T>(selector: (s: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("WorkspaceStoreProvider missing");
  return useStore(store, selector);
}
```

**File:** `components/workspace/workspace-store-provider.tsx` — re-exports the provider as a `"use client"` boundary so server components can render it.

```tsx
"use client";
export { WorkspaceStoreProvider } from "@/stores/workspace-store";
```

Commit: `feat(workspace-store): provider + zustand store with cards/sprints/versions/links/components mutators`

---

## Task 3 — Realtime hook

**File:** `hooks/use-workspace-realtime.ts`

```ts
"use client";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useWorkspaceStore, type WorkspaceState } from "@/stores/workspace-store";

type CardSnap = WorkspaceState["cards"][number];

function rowToCard(r: Record<string, unknown>, boardId: string): CardSnap {
  return {
    id: r.id as string, boardId, listId: r.list_id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    type: (r.type as string) ?? "task",
    parentCardId: (r.parent_card_id as string | null) ?? null,
    sprintId: (r.sprint_id as string | null) ?? null,
    storyPoints: (r.story_points as number | null) ?? null,
    startDate: r.start_date ? new Date(r.start_date as string) : null,
    targetDate: r.target_date ? new Date(r.target_date as string) : null,
    dueDate: r.due_date ? new Date(r.due_date as string) : null,
    dueComplete: Boolean(r.due_complete),
    archived: Boolean(r.archived),
    createdAt: r.created_at ? new Date(r.created_at as string) : new Date(),
  };
}

export function useWorkspaceRealtime(workspaceId: string) {
  const upsertCard = useWorkspaceStore((s) => s.upsertCard);
  const patchCard = useWorkspaceStore((s) => s.patchCard);
  const removeCard = useWorkspaceStore((s) => s.removeCard);
  const upsertSprint = useWorkspaceStore((s) => s.upsertSprint);
  const patchSprint = useWorkspaceStore((s) => s.patchSprint);
  const removeSprint = useWorkspaceStore((s) => s.removeSprint);
  const upsertVersion = useWorkspaceStore((s) => s.upsertVersion);
  const patchVersion = useWorkspaceStore((s) => s.patchVersion);
  const removeVersion = useWorkspaceStore((s) => s.removeVersion);
  const upsertCardLink = useWorkspaceStore((s) => s.upsertCardLink);
  const removeCardLink = useWorkspaceStore((s) => s.removeCardLink);
  const upsertCardVersion = useWorkspaceStore((s) => s.upsertCardVersion);
  const removeCardVersion = useWorkspaceStore((s) => s.removeCardVersion);
  const boards = useWorkspaceStore((s) => s.boards);

  useEffect(() => {
    if (boards.length === 0) return;
    const supa = createSupabaseBrowser();
    const channel = supa.channel(`ws:${workspaceId}`);

    // cards — filter by board_id IN (...) requires individual sub per board because
    // postgres_changes only supports eq filter. Subscribe one filter per board.
    for (const b of boards) {
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "cards", filter: `board_id=eq.${b.id}`,
      }, (payload) => {
        if (payload.eventType === "INSERT" && payload.new) {
          upsertCard(rowToCard(payload.new as Record<string, unknown>, b.id));
        } else if (payload.eventType === "UPDATE" && payload.new) {
          patchCard((payload.new as { id: string }).id, rowToCard(payload.new as Record<string, unknown>, b.id));
        } else if (payload.eventType === "DELETE" && payload.old) {
          removeCard((payload.old as { id: string }).id);
        }
      });
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "card_links", filter: `board_id=eq.${b.id}`,
      }, (payload) => {
        if (payload.eventType === "INSERT" && payload.new) {
          const r = payload.new as Record<string, unknown>;
          upsertCardLink({
            id: r.id as string, fromCardId: r.from_card_id as string, toCardId: r.to_card_id as string,
            kind: r.kind as string, boardId: b.id,
          });
        } else if (payload.eventType === "DELETE" && payload.old) {
          removeCardLink((payload.old as { id: string }).id);
        }
      });
    }

    channel.on("postgres_changes", {
      event: "*", schema: "public", table: "sprints", filter: `workspace_id=eq.${workspaceId}`,
    }, (payload) => {
      if (payload.eventType === "INSERT" && payload.new) {
        const r = payload.new as Record<string, unknown>;
        upsertSprint({
          id: r.id as string, name: r.name as string, goal: (r.goal as string | null) ?? null,
          startDate: new Date(r.start_date as string), endDate: new Date(r.end_date as string),
          state: r.state as string,
        });
      } else if (payload.eventType === "UPDATE" && payload.new) {
        const r = payload.new as Record<string, unknown>;
        patchSprint(r.id as string, {
          name: r.name as string, goal: (r.goal as string | null) ?? null,
          startDate: new Date(r.start_date as string), endDate: new Date(r.end_date as string),
          state: r.state as string,
        });
      } else if (payload.eventType === "DELETE" && payload.old) {
        removeSprint((payload.old as { id: string }).id);
      }
    });

    channel.on("postgres_changes", {
      event: "*", schema: "public", table: "versions", filter: `workspace_id=eq.${workspaceId}`,
    }, (payload) => {
      if (payload.eventType === "INSERT" && payload.new) {
        const r = payload.new as Record<string, unknown>;
        upsertVersion({
          id: r.id as string, name: r.name as string,
          semver: (r.semver as string | null) ?? null,
          state: r.state as string,
          releaseDate: r.release_date ? new Date(r.release_date as string) : null,
        });
      } else if (payload.eventType === "UPDATE" && payload.new) {
        const r = payload.new as Record<string, unknown>;
        patchVersion(r.id as string, {
          name: r.name as string,
          semver: (r.semver as string | null) ?? null,
          state: r.state as string,
          releaseDate: r.release_date ? new Date(r.release_date as string) : null,
        });
      } else if (payload.eventType === "DELETE" && payload.old) {
        removeVersion((payload.old as { id: string }).id);
      }
    });

    channel.on("postgres_changes", {
      event: "*", schema: "public", table: "card_versions", filter: `workspace_id=eq.${workspaceId}`,
    }, (payload) => {
      if (payload.eventType === "INSERT" && payload.new) {
        const r = payload.new as Record<string, unknown>;
        upsertCardVersion({
          cardId: r.card_id as string, versionId: r.version_id as string,
          kind: r.kind as string,
        });
      } else if (payload.eventType === "DELETE" && payload.old) {
        const r = payload.old as Record<string, unknown>;
        removeCardVersion(r.card_id as string, r.version_id as string, r.kind as string);
      }
    });

    channel.subscribe();
    return () => { supa.removeChannel(channel); };
  }, [workspaceId, boards, upsertCard, patchCard, removeCard, upsertSprint, patchSprint, removeSprint,
      upsertVersion, patchVersion, removeVersion, upsertCardLink, removeCardLink,
      upsertCardVersion, removeCardVersion]);
}
```

Commit: `feat(realtime): useWorkspaceRealtime — single channel for cards/sprints/versions/links/card_versions across workspace boards`

---

## Task 4 — Mount providers on workspace pages

Modify:

- `app/(app)/w/[wsId]/roadmap/page.tsx` — fetch `getWorkspaceSnapshot`, wrap children in `<WorkspaceStoreProvider initial={snap}>`.
- `app/(app)/w/[wsId]/backlog/page.tsx` — same. Backlog rendering should still server-fetch its specific lists, but the snapshot powers any client-side cross-view sync.
- `app/(app)/dashboards/[dashboardId]/page.tsx` — only mount provider when `dashboard.workspaceId !== null`. Pass workspaceId-scoped snapshot.

Commit: `feat(workspace-pages): mount WorkspaceStoreProvider with snapshot on roadmap/backlog/dashboard pages`

---

## Task 5 — `RoadmapView` reads from workspace store

Refactor `components/roadmap/roadmap-view.tsx`:

- Remove `cards: RoadmapCard[]` and `links: ...` props (or keep for SSR seed but ignore after first render).
- Add `const cards = useWorkspaceStore((s) => s.cards.filter((c) => !c.archived));`
- Mount `useWorkspaceRealtime(workspaceId)` once at the top of the component.
- On bar drag end: call `updateCard()` as before; the CDC echo will reconcile state via the realtime hook. Drop any local optimistic-set that mutated props.
- Add a small "live" indicator in the header (a pulsing dot) when the realtime channel is subscribed.

The `RoadmapView` already uses memoized `groupByEpic` + `stackInLane` via `lib/roadmap/layout.ts` — no changes there beyond Task 6.

Commit: `refactor(roadmap): RoadmapView reads cards/links from useWorkspaceStore + useWorkspaceRealtime`

---

## Task 6 — Subtask child rows in Gantt

Modify `lib/roadmap/layout.ts`:

```ts
export type Lane<C extends RoadmapCard> = {
  id: string;
  title: string;
  headerCard: C | null;
  rows: Array<C[]>;
  // NEW: subtasks grouped per parent in the lane
  subtaskRowsByParent: Record<string, Array<C[]>>;
  expandedParents: Set<string>;
};
```

Extend `groupByEpic`:
- Same as before, but additionally collect subtasks (`type === "subtask"`) and group them by `parentCardId`.
- For each parent in the lane, run `stackInLane` independently on its subtasks → rows of subtask bars.

Extend `RoadmapView`:
- For each parent card in a lane, render a small caret icon left of the bar. Click → toggles `expandedParents` set (lifted state).
- When expanded: render the parent's subtask rows under the parent's row, indented (left padding 16px), with bars at half height (h-3 vs h-7).

Subtasks without `start_date` / `target_date` are NOT rendered. Add a small "+N undated subtasks" chip after the parent bar when applicable.

Commit: `feat(roadmap): subtask child rows under expandable parent bars`

---

## Task 7 — Sprint overlay

**File:** `components/roadmap/sprint-overlay.tsx`

```tsx
"use client";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { dayDiff, pixelsPerDay, type Zoom } from "@/lib/roadmap/dates";

export function SprintOverlay({
  zoom, gridStart, gridEnd, height,
}: {
  zoom: Zoom; gridStart: Date; gridEnd: Date; height: number;
}) {
  const sprints = useWorkspaceStore((s) =>
    s.sprints.filter((sp) => sp.state !== "completed"));
  const ppd = pixelsPerDay(zoom);

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {sprints.map((sp, i) => {
        const startDays = Math.max(0, dayDiff(gridStart, sp.startDate));
        const endDays = Math.min(dayDiff(gridStart, gridEnd), dayDiff(gridStart, sp.endDate));
        const x = startDays * ppd;
        const w = Math.max(0, (endDays - startDays) * ppd);
        if (w <= 0) return null;
        const tone = sp.state === "active" ? "rgb(255 255 255 / 0.06)" : "rgb(255 255 255 / 0.03)";
        return (
          <div key={sp.id} className="absolute top-0" style={{ left: x, width: w, height,
            background: tone, borderLeft: "1px dashed rgb(255 255 255 / 0.18)", borderRight: "1px dashed rgb(255 255 255 / 0.18)" }}>
            <span className="absolute top-1 left-2 mono-meta-sm text-fg-faint">
              {sp.name.toUpperCase()}{sp.state === "active" ? " · ACTIVE" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

Mount in `RoadmapView` underneath the bars layer (z-order = -1 vs bars).

Commit: `feat(roadmap): SprintOverlay translucent bands aligned to grid`

---

## Task 8 — Move-dates-with-sprint suggestion

Modify `actions/sprints.ts` `startSprintImpl` to additionally return an array of "conflict cards":

```ts
return {
  sprint: started,
  conflictCards: cardsInSprintWithDatesOutsideWindow,
};
```

A card "conflicts" if it's `sprintId === started.id` AND (`target_date != null && target_date > started.endDate`) OR (`start_date != null && start_date < started.startDate`).

Add new action `bulkShiftCardDates(token, { cardIds, deltaMinutes })` that updates `start_date` and `target_date` by the delta on each. Validation cap: 50 cards.

UI: `components/sprint/sprint-date-conflict-dialog.tsx` — opens after `startSprint` returns conflicts. Lists cards + suggested shift. User confirms → calls `bulkShiftCardDates` with computed delta.

Wire into the existing start-sprint flow on the backlog page.

Commit: `feat(sprints): startSprint returns conflictCards + bulkShiftCardDates action + dialog`

---

## Task 9 — Dashboard gadget "On roadmap"

Append to `lib/validation.ts` `GadgetType`: `"on_roadmap"`.

Add resolver `resolveOnRoadmap(token, c: { workspaceId: string })` to `lib/dashboards/resolvers.ts`:

```ts
export async function resolveOnRoadmap(token: string, c: { workspaceId: string }) {
  return dbAsUser(token, async (tx) => {
    const rows = await tx.select({
      total: sql<number>`count(*)::int`,
      scheduled: sql<number>`count(*) filter (where start_date is not null or target_date is not null)::int`,
      unscheduled: sql<number>`count(*) filter (where start_date is null and target_date is null)::int`,
      overdue: sql<number>`count(*) filter (where target_date is not null and target_date < now() and due_complete = false and archived = false)::int`,
    }).from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(boards.workspaceId, c.workspaceId), eq(cards.archived, false)));
    return rows[0] ?? { total: 0, scheduled: 0, unscheduled: 0, overdue: 0 };
  });
}
```

Component: `components/dashboard/gadgets/gadget-on-roadmap.tsx` — 4-stat grid (TOTAL / SCHEDULED / UNSCHEDULED / OVERDUE) using big numbers + small labels.

Modify `add-gadget-dialog.tsx` — add the type option with workspace-required config.

Modify `dashboard-grid.tsx` — wire up the resolver.

Commit: `feat(dashboards): on_roadmap gadget — total/scheduled/unscheduled/overdue counts`

---

## Task 10 — Tests

`tests/integration/workspace-snapshot.test.ts`:

1. Create user → workspace → board → list → 3 cards. Assert `getWorkspaceSnapshot` returns 1 board, 3 cards.
2. Add a sprint, version, component to the workspace. Re-snapshot. Assert all returned.
3. Cross-workspace isolation: create user B with own workspace. B's `getWorkspaceSnapshot` returns no cards from A.

`tests/integration/start-sprint-conflict.test.ts`:

1. Create sprint with start=now, end=now+7d. Create a card in it with `target_date = now+30d`.
2. `startSprintImpl` returns `conflictCards.length === 1`.
3. `bulkShiftCardDates` with delta = -23d reduces `target_date` to within sprint window. Re-running startSprint conflict check shows zero.

Run integration suite — should be 121 + ~5 = ~126.

Commit: `test(workspace-store): snapshot + sprint conflict detection`

---

## Task 11 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm run test:unit` (target ~126).
- `npx playwright test` — all 9 still passing.

## Acceptance smoke

1. Open roadmap in tab A. Open same workspace's backlog in tab B. Drag a bar in tab A → bar position updates → reload backlog → card position in sprint reflects (NB: positions don't change, but date-driven progress should).
2. Start a sprint with a card whose `target_date > sprint.endDate` → confirmation dialog shows → confirm → card's date updated.
3. Open a parent card on roadmap → click caret → see subtask bars.
4. Sprint overlay bands visible behind bars; active sprint labeled.
5. Add `on_roadmap` gadget to a workspace dashboard → see 4 numbers.

---

## Self-review notes

- Single-channel-per-workspace would be ideal but Supabase Realtime `postgres_changes` only allows `eq` filters per table — we register N filters per board. For workspaces with > 100 boards this becomes slow; acceptable for v1.
- `getWorkspaceSnapshot` returns ALL cards across the workspace's boards — for very large workspaces (thousands of cards) this is expensive. Future optimization: paginate by date window for the roadmap path; backlog already pages.
- The dashboard provider only mounts when `dashboard.workspaceId !== null`. Personal dashboards don't get the workspace store; their gadgets continue to query directly.
- Subtask rendering on roadmap shows ONLY subtasks that themselves have `start_date` or `target_date`. Parent's bar implicitly schedules subtask group; future polish: derive subtask defaults from parent.
- Sprint overlay only renders `state IN ('planned','active')`. Completed sprints not shown to keep timeline clean.
