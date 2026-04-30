# Plan #13 — Roadmap / Timeline / Gantt

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** A workspace-level **Roadmap** view that renders cards as horizontal bars on a calendar. Each card has a `start_date` and `target_date` (both nullable). Bars span those dates. Bars are **grouped into rows by epic** (parent_card_id of type `epic`). Stories without an epic land in an "Uncategorized" lane. **Dependency arrows** are drawn between bars whose cards are linked with `is_blocked_by` (drawn from blocker → blocked).

The view supports three zoom levels: **week / month / quarter**. Time scale is purely client-side (SVG, no Gantt lib). Bars can be **resized** by dragging the edges and **moved** by dragging the body — both commit `start_date` / `target_date` via the existing `updateCard` Server Action.

**Out of scope (deferred):**
- Cross-workspace roadmap.
- Dependency cycle detection during drag.
- Critical path highlighting.
- Vertical scroll virtualization (we cap at first 200 bars to keep it simple).
- Touch-friendly drag (mouse only for v1).

**Definition of done:**
- New page `/w/[workspaceId]/roadmap` accessible from top-nav (next to BACKLOG/VERSIONS).
- Cards from any board in the workspace whose card-type is `epic` or `story` and have BOTH `start_date` and `target_date` set are rendered as bars.
- Lanes: one per epic (heading = epic title). Stories under that epic stack into the lane. Stories with no parent epic appear under "Uncategorized".
- Zoom toggle (week / month / quarter) persists in URL `?zoom=month`.
- Drag the body of a bar → move both dates by the same delta. Drag the right edge → only `target_date` changes. Drag the left edge → only `start_date` changes. Snap to day.
- Optimistic UI; on server error, revert.
- Dependency arrow rendered between two bars when card B has an `is_blocked_by` link to card A and both bars exist on the visible roadmap. Arrow is a thin SVG path with an arrowhead.
- All existing tests still pass. New unit tests cover the date-arithmetic helpers.

---

## File structure

**Migration:**
- `supabase/migrations/0033_card_roadmap_dates.sql` — adds `cards.start_date timestamptz` and `cards.target_date timestamptz` (nullable). `due_date` already exists — kept as-is and is independent (deadline vs. planned end).

**Schema:** extend `cards` Drizzle table.

**Validation:** extend `UpdateCardInput` to accept `startDate` and `targetDate`.

**Server actions:** no new file; `updateCardImpl` (already extended through plans #8 / #12 / #22) gains two more optional fields.

**Read helpers:**
- `lib/queries/roadmap.ts` — `listRoadmapCards(token, workspaceId)` returns cards with start+target set joined to their board title; ordered by `start_date asc`. Plus `listRoadmapLinks(token, workspaceId)` returning `is_blocked_by` links between roadmap cards.

**Lib (pure, easily unit-tested):**
- `lib/roadmap/dates.ts` — date helpers:
  - `startOfDay(d)`, `addDays(d, n)`, `dayDiff(a, b)`.
  - `Zoom` type = `"week" | "month" | "quarter"`.
  - `pixelsPerDay(zoom)` → e.g. `week: 60, month: 24, quarter: 8`.
  - `gridStartFor(now, zoom)` → start-of-period.
  - `gridEndFor(now, zoom)` → 26 weeks ahead by default; OR enough to cover all cards' target_date.
  - `xForDate(date, gridStart, ppd)` → number.
- `lib/roadmap/layout.ts` — pure layout:
  - `groupByEpic(cards)` → `Lane[]` where Lane = `{ id, title, kind: "epic" | "uncategorized", cards: RoadmapCard[] }`.
  - Stack cards within a lane to avoid overlap (each lane has multiple horizontal "rows" — Linear-style; cards on overlapping date ranges go to next sub-row).

**Routes:**
- `app/(app)/w/[workspaceId]/roadmap/page.tsx` (server) — fetches data, renders client view.

**Components:**
- `components/roadmap/roadmap-view.tsx` (client) — owns zoom toggle, header rule, lanes, drag state.
- `components/roadmap/roadmap-bar.tsx` (client) — single bar with hover preview + drag handles.
- `components/roadmap/dependency-arrows.tsx` (client) — SVG overlay drawing arrows.

**Modify:**
- `components/nav/top-nav.tsx` — add ROADMAP link conditional on `activeWorkspaceId`.

**Tests:**
- `tests/unit/roadmap-dates.test.ts` — date helpers (10+ cases).
- `tests/unit/roadmap-layout.test.ts` — group + stack (8+ cases).
- `tests/integration/roadmap-cards.test.ts` — `listRoadmapCards` + `listRoadmapLinks` query correctness + RLS.

---

## Task 1 — Migration + schema + validation

`supabase/migrations/0033_card_roadmap_dates.sql`:

```sql
alter table public.cards
  add column start_date timestamptz,
  add column target_date timestamptz;

create index on public.cards (board_id, start_date)
  where start_date is not null;
```

(Note: `due_date` already exists and remains separate — `due_date` is a hard deadline; `target_date` is the planned end of work for roadmap purposes. UI lets the user keep them independent.)

Drizzle (extend cards):

```ts
startDate: timestamp("start_date", { withTimezone: true }),
targetDate: timestamp("target_date", { withTimezone: true }),
```

Extend `UpdateCardInput` in `lib/validation.ts`:

```ts
startDate: z.union([z.string(), z.date()]).nullable().optional(),
targetDate: z.union([z.string(), z.date()]).nullable().optional(),
```

Extend `updateCardImpl` body to merge into `patch`. Apply migration + `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`.

Verify all 89 existing integration tests still pass.

**Commit:** `feat(db): cards.start_date + target_date for roadmap`.

Update `hooks/use-board-realtime.ts` `rowToCard` to map `start_date` / `target_date` to camelCase. (Required so realtime updates don't drop the new fields.)

**Commit:** `feat(realtime): map start_date + target_date in rowToCard`.

---

## Task 2 — Date helpers (TDD)

`tests/unit/roadmap-dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, dayDiff, pixelsPerDay,
  gridStartFor, gridEndFor, xForDate,
} from "@/lib/roadmap/dates";

describe("startOfDay / addDays / dayDiff", () => {
  it("startOfDay strips time component", () => {
    const d = new Date("2026-04-30T15:42:11Z");
    expect(startOfDay(d).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });
  it("addDays adds N calendar days", () => {
    expect(addDays(new Date("2026-04-30T00:00:00Z"), 5).toISOString())
      .toBe("2026-05-05T00:00:00.000Z");
  });
  it("dayDiff returns whole-day delta", () => {
    expect(dayDiff(new Date("2026-04-30"), new Date("2026-05-05"))).toBe(5);
    expect(dayDiff(new Date("2026-05-05"), new Date("2026-04-30"))).toBe(-5);
  });
});

describe("zoom + grid bounds", () => {
  it("pixelsPerDay scales with zoom", () => {
    expect(pixelsPerDay("week")).toBe(60);
    expect(pixelsPerDay("month")).toBe(24);
    expect(pixelsPerDay("quarter")).toBe(8);
  });
  it("gridStartFor snaps backward to start-of-period", () => {
    const ref = new Date("2026-05-15T12:00:00Z");
    expect(gridStartFor(ref, "week").toISOString().slice(0, 10)).toBe("2026-05-11"); // Mon
    expect(gridStartFor(ref, "month").toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(gridStartFor(ref, "quarter").toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("gridEndFor returns at least 6 months ahead of start", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const end = gridEndFor(start, "month");
    expect(dayDiff(start, end)).toBeGreaterThanOrEqual(180);
  });
});

describe("xForDate", () => {
  it("computes pixels = (date - gridStart) * pixelsPerDay", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const ppd = pixelsPerDay("month"); // 24
    expect(xForDate(new Date("2026-05-11T00:00:00Z"), start, ppd)).toBe(240);
    expect(xForDate(new Date("2026-05-01T00:00:00Z"), start, ppd)).toBe(0);
  });
});
```

Implement `lib/roadmap/dates.ts` to satisfy all tests.

**Commit:** `feat(roadmap): date helpers + unit tests`.

---

## Task 3 — Lane / stack layout (TDD)

`tests/unit/roadmap-layout.test.ts` (representative, write all needed):

```ts
import { describe, it, expect } from "vitest";
import { groupByEpic, stackInLane, type RoadmapCard } from "@/lib/roadmap/layout";

const card = (over: Partial<RoadmapCard> = {}): RoadmapCard => ({
  id: over.id ?? "c", title: over.title ?? "C",
  type: over.type ?? "story", parentCardId: over.parentCardId ?? null,
  startDate: over.startDate ?? new Date("2026-05-01"),
  targetDate: over.targetDate ?? new Date("2026-05-05"),
  boardId: "B",
});

describe("groupByEpic", () => {
  it("creates one lane per epic + Uncategorized for orphan stories", () => {
    const epic1 = card({ id: "e1", title: "Epic A", type: "epic", parentCardId: null });
    const s1 = card({ id: "s1", parentCardId: "e1" });
    const s2 = card({ id: "s2", parentCardId: null });
    const lanes = groupByEpic([epic1, s1, s2]);
    expect(lanes.find(l => l.id === "e1")?.cards.map(c => c.id)).toEqual(["s1"]);
    expect(lanes.find(l => l.id === "uncategorized")?.cards.map(c => c.id)).toEqual(["s2"]);
  });
  it("includes the epic itself as a header bar (own card if dates set)", () => {
    const epic1 = card({ id: "e1", title: "Epic A", type: "epic", parentCardId: null });
    const lanes = groupByEpic([epic1]);
    expect(lanes.find(l => l.id === "e1")?.headerCard?.id).toBe("e1");
  });
});

describe("stackInLane", () => {
  it("stacks overlapping cards onto separate sub-rows", () => {
    const a = card({ id: "a", startDate: new Date("2026-05-01"), targetDate: new Date("2026-05-10") });
    const b = card({ id: "b", startDate: new Date("2026-05-05"), targetDate: new Date("2026-05-15") }); // overlap
    const c = card({ id: "c", startDate: new Date("2026-05-16"), targetDate: new Date("2026-05-20") }); // after b
    const placed = stackInLane([a, b, c]);
    expect(placed.find(p => p.card.id === "a")?.row).toBe(0);
    expect(placed.find(p => p.card.id === "b")?.row).toBe(1);
    expect(placed.find(p => p.card.id === "c")?.row).toBe(0);
  });
});
```

Implement `lib/roadmap/layout.ts`:
- `groupByEpic(cards)` returns `Lane[]` ordered: epics first (alphabetical by title), then "Uncategorized" last. Each lane has `headerCard?: RoadmapCard | null` (only set for epic lanes).
- `stackInLane(cards)` returns `{ card, row }[]`. Greedy: sort by start, assign each card to the lowest row whose latest-end ≤ start.

**Commit:** `feat(roadmap): groupByEpic + stackInLane + unit tests`.

---

## Task 4 — Read helpers + integration tests

`lib/queries/roadmap.ts`:

```ts
export type RoadmapCard = {
  id: string; title: string; type: string; parentCardId: string | null;
  startDate: Date; targetDate: Date;
  boardId: string; boardTitle: string; archived: boolean;
};

export async function listRoadmapCards(token: string, workspaceId: string): Promise<RoadmapCard[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: cards.id, title: cards.title, type: cards.type,
        parentCardId: cards.parentCardId,
        startDate: cards.startDate, targetDate: cards.targetDate,
        boardId: cards.boardId, boardTitle: boards.title,
        archived: cards.archived,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(
        eq(boards.workspaceId, workspaceId),
        eq(cards.archived, false),
        isNotNull(cards.startDate),
        isNotNull(cards.targetDate),
      ))
      .orderBy(asc(cards.startDate))
      .limit(200);
    return rows.filter(r => r.startDate && r.targetDate)
      .map(r => ({
        ...r,
        startDate: r.startDate as Date,
        targetDate: r.targetDate as Date,
      }));
  });
}

export async function listRoadmapLinks(token: string, workspaceId: string) {
  // Pull is_blocked_by edges between two cards both in workspace boards.
  return dbAsUser(token, async (tx) =>
    tx.execute(sql`
      select cl.from_card_id as from_id, cl.to_card_id as to_id
      from public.card_links cl
      join public.cards a on a.id = cl.from_card_id
      join public.cards b on b.id = cl.to_card_id
      join public.boards ba on ba.id = a.board_id
      join public.boards bb on bb.id = b.board_id
      where cl.kind = 'is_blocked_by'
        and ba.workspace_id = ${workspaceId}
        and bb.workspace_id = ${workspaceId}
    `).then((res) => (res as unknown as Array<{from_id: string; to_id: string}>))
  );
}
```

`tests/integration/roadmap-cards.test.ts`:

1. **Returns only cards with both dates set in current workspace.**
   - User makes 2 cards in their workspace; sets dates on 1; create another in a foreign workspace with dates; assert only 1 card in result.
2. **Returns linked-by edges.**
   - User makes A and B in same workspace, with `blocks` link from A to B (mirror creates `is_blocked_by` from B to A); assert one row `{from: B, to: A}`.
3. **RLS isolation.**
   - User from workspace X cannot see cards from workspace Y.

Run: `npm run test:unit` → 92 expected (89 + 3).

**Commit:** `feat(queries): listRoadmapCards + listRoadmapLinks + integration tests`.

---

## Task 5 — UI: page + view shell

`app/(app)/w/[workspaceId]/roadmap/page.tsx` (server):

```tsx
export default async function RoadmapPage({ params }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const [cards, links] = await Promise.all([
    listRoadmapCards(token, workspaceId),
    listRoadmapLinks(token, workspaceId),
  ]);
  return (
    <div className="px-6 py-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="serif-display text-3xl">{ws.name} · Roadmap</h1>
        <span className="mono-meta text-fg-muted">{cards.length} CARDS</span>
      </header>
      <RoadmapView initialCards={cards} initialLinks={links} workspaceId={workspaceId} />
    </div>
  );
}
```

`components/roadmap/roadmap-view.tsx` (client) — see plan code in Task 6.

Modify `components/nav/top-nav.tsx` to add a `ROADMAP` link inside the existing `activeWorkspaceId` guard.

**Commit:** `feat(roadmap): /w/{ws}/roadmap page + nav link`.

---

## Task 6 — RoadmapView (drag-resize-move + zoom + arrows)

`components/roadmap/roadmap-view.tsx`:

Big client component. Outline:
- Reads `useSearchParams` for `?zoom=`. Default `month`. URL push on toggle.
- State: `cards: RoadmapCard[]` initialized from prop; updates locally on optimistic edits.
- Compute `gridStart`, `gridEnd`, `ppd`, `width = (dayDiff(start, end)) * ppd`.
- Render header strip (date labels) + lane rows.
- Each lane: title sticky-left + sub-row containers + bars (`<RoadmapBar>` per card).
- Wrap everything in a horizontally scrollable container.
- Mount `<DependencyArrows>` overlay.
- Drag handlers (defined here, passed to bars):
  - `handleStartResize(cardId, deltaPixels)` → compute `addDays(currentTarget, days)` (right edge) or `addDays(currentStart, days)` (left edge); update local + call `updateCard({ id, startDate / targetDate: ... })`.
  - `handleMove(cardId, deltaPixels)` → shift both by same days.
  - On error, revert.
- Use HTML5 `pointerdown` / `pointermove` / `pointerup` on a `<div>` with refs (no extra dep; dnd-kit is overkill for this).

`components/roadmap/roadmap-bar.tsx`:

```tsx
"use client";
import type { RoadmapCard } from "@/lib/queries/roadmap";

export function RoadmapBar({
  card, x, width, row,
  onMoveStart, onResizeLeftStart, onResizeRightStart,
}: {
  card: RoadmapCard;
  x: number; width: number; row: number;
  onMoveStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeLeftStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeRightStart: (e: React.PointerEvent, cardId: string) => void;
}) {
  return (
    <div
      style={{ left: x, width, top: row * 36 + 4 }}
      className="absolute h-7 rounded-md bg-fg/10 border border-hairline-hi backdrop-blur-sm
                 hover:bg-fg/15 transition-colors cursor-grab active:cursor-grabbing
                 flex items-center px-2 select-none group/bar"
      onPointerDown={(e) => onMoveStart(e, card.id)}
      data-card-id={card.id}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-fg/30 rounded-l-md"
        onPointerDown={(e) => { e.stopPropagation(); onResizeLeftStart(e, card.id); }}
        aria-hidden
      />
      <span
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-fg/30 rounded-r-md"
        onPointerDown={(e) => { e.stopPropagation(); onResizeRightStart(e, card.id); }}
        aria-hidden
      />
      <span className="text-xs text-fg truncate">{card.title}</span>
    </div>
  );
}
```

`components/roadmap/dependency-arrows.tsx`:

Pure SVG overlay positioned absolutely over the bars. For each link (from, to):
- Find the source bar's right-edge position + center-y.
- Find the target bar's left-edge position + center-y.
- Render `<path d="M sx,sy C sx+30,sy ex-30,ey ex,ey" stroke="currentColor" stroke-opacity="0.4" />`.
- Tiny arrow head at the end via marker.

Key implementation decisions:
- All bars render absolute-positioned within a relative container; arrows are computed from bar bounding boxes via ref map (or recomputed from layout coordinates passed in as props).
- For simplicity, pass `barCoords: Map<string, {x, y, w}>` from RoadmapView so the arrows component is fully data-driven and re-renders cleanly on zoom change.

**Commit:** `feat(roadmap): RoadmapView + RoadmapBar + DependencyArrows (drag-resize-move + zoom + dependency arrows)`.

---

## Task 7 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean. New routes:
  - `/w/[workspaceId]/roadmap`
- `npm run test:unit` → **101 expected** (89 baseline + 3 integration + ~9 unit = ~12 added; actual count may vary slightly).
- `npx playwright test` → 6 still green.
- Manual smoke:
  - On a workspace with at least 2 cards both having `start_date` and `target_date` set (set them via card modal — note: card modal does not yet expose start/target picker; **add to card modal as part of this commit OR document as follow-up.**)

> **Decision on card modal start/target picker:** Add a small `RoadmapDatesPicker` component into the card modal (next to `DueSection`). Simple two date-inputs. Mounts only when card type is `epic` or `story`. Saves via `updateCard({ id, startDate, targetDate })`. If omitted, users would have no way to populate the roadmap from the UI.

**Commit (with Task 6):** include `components/board/card/roadmap-dates-section.tsx` + wire into `card-modal.tsx`.

---

## Self-Review Notes

- **Spec coverage:** roadmap §Planning-2 (Roadmap / Gantt / Timeline) — fully implemented for v1.
- **Out of scope (deferred):** dependency cycle detection, virtualization, touch DnD, bar resize-when-dragging-into-overlap re-stacking on the fly (we re-stack on next render).
- **Why not dnd-kit:** roadmap drag is fundamentally pixel-based, single-axis, with edge handles. dnd-kit's API is the wrong shape; raw `pointer*` events are 30 lines.
- **`due_date` vs `target_date`:** intentionally separate. `due_date` is a hard deadline (could be earlier than `target_date` and trigger SLA breaches). `target_date` is the planned completion for roadmap purposes.
- **Performance:** capped at 200 cards. With horizontal scroll, the absolute-positioned bars don't pay layout cost for off-screen items (browser optimizes). If 200+ becomes the norm, virtualize lanes.
- **Auto-stacking interaction with drag:** during drag we don't reflow the lane (would feel jittery). On pointerup, the action commits + roadmap re-renders, possibly re-stacking visually. Acceptable.
