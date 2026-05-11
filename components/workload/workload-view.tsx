"use client";
import Link from "next/link";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkloadCard, WorkloadProfile } from "@/lib/queries/workload";
import { useWorkloadSync } from "@/hooks/use-workload-sync";
import { Select } from "@/components/ui/select";
import { bucketsBetween, fillBuckets } from "@/lib/workload/buckets";
import {
  WorkloadToolbar,
  type LanesMode,
  type RangePreset,
  type SortKind,
} from "./workload-toolbar";
import { WorkloadBar } from "./workload-bar";
import { useWorkloadDrag } from "./use-workload-drag";

// 40h/week capacity line on the per-lane histogram. Anything above this
// is treated as over-allocation: the bucket bar tints magenta and the
// lane label gets an "OVER" chip.
const WEEKLY_CAPACITY_MIN = 2400;
const HISTO_HEIGHT = 16;

type PriorityFilter = "all" | "p0" | "p1" | "p2" | "p3" | "p4";
type CompletedFilter = "hide" | "show";

const PRIORITY_VALUES: PriorityFilter[] = ["all", "p0", "p1", "p2", "p3", "p4"];

function parsePriority(v: string | null): PriorityFilter {
  if (v && (PRIORITY_VALUES as string[]).includes(v)) return v as PriorityFilter;
  return "all";
}
function parseCompleted(v: string | null): CompletedFilter {
  return v === "show" ? "show" : "hide";
}
function parseLanesMode(v: string | null): LanesMode {
  return v === "workspace" ? "workspace" : "user";
}

const MS_DAY = 86_400_000;
const LANE_LABEL_WIDTH = 200;
// Per-range density.  WEEK is short (~10 days) so each day is wide and
// bars + day labels breathe.  QUARTER spans ~3 months so we trade
// per-day density for fitting more on screen.
const PX_PER_DAY_BY_RANGE: Record<RangePreset, number> = {
  week: 56,
  month: 22,
  quarter: 9,
};
const LANE_BAR_HEIGHT = 22;
const LANE_PADDING_Y = 6;

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DAY);
}
function fmtMonthShort(d: Date): string {
  return d
    .toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })
    .toUpperCase();
}
function dayName(d: Date): number {
  return d.getUTCDay();
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_DAY);
}

function rangeFor(preset: RangePreset, today: Date): { start: Date; end: Date } {
  if (preset === "week") {
    return { start: addDays(today, -2), end: addDays(today, 7) };
  }
  if (preset === "month") {
    return { start: addDays(today, -7), end: addDays(today, 28) };
  }
  return { start: addDays(today, -7), end: addDays(today, 90) };
}

// Pack cards into vertical sub-rows so overlapping spans don't sit on
// top of each other.  Greedy first-fit.
function packLanes(cards: WorkloadCard[]): { card: WorkloadCard; row: number }[] {
  const sorted = [...cards].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  const rows: number[] = []; // rows[i] = end-time of last card placed in row i
  const out: { card: WorkloadCard; row: number }[] = [];
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] <= c.startDate.getTime()) {
        rows[i] = c.targetDate.getTime() + MS_DAY;
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      rows.push(c.targetDate.getTime() + MS_DAY);
      placed = rows.length - 1;
    }
    out.push({ card: c, row: placed });
  }
  return out;
}

export function WorkloadView({
  cards,
  profiles,
}: {
  cards: WorkloadCard[];
  profiles: WorkloadProfile[];
}) {
  useWorkloadSync();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [wsFilter, setWsFilter] = useState("");
  const [sprintFilter, setSprintFilter] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("month");
  const PX_PER_DAY = PX_PER_DAY_BY_RANGE[rangePreset];
  const [sortKind, setSortKind] = useState<SortKind>("peak");

  // Priority + completed filters live in the URL for shareability.
  const priorityFilter: PriorityFilter = parsePriority(
    searchParams.get("prio"),
  );
  const completedFilter: CompletedFilter = parseCompleted(
    searchParams.get("done"),
  );
  const lanesMode: LanesMode = parseLanesMode(searchParams.get("lanes"));

  const writeSearchParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  function setPriorityFilter(next: PriorityFilter) {
    writeSearchParam("prio", next === "all" ? null : next);
  }
  function setCompletedFilter(next: CompletedFilter) {
    // Default = "hide", so only persist when "show".
    writeSearchParam("done", next === "show" ? "show" : null);
  }
  function setLanesMode(next: LanesMode) {
    // Default = "user", so only persist when "workspace".
    writeSearchParam("lanes", next === "workspace" ? "workspace" : null);
  }

  const today = useMemo(() => startOfDayUtc(new Date()), []);
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => rangeFor(rangePreset, today),
    [rangePreset, today],
  );
  const totalDays = dayDiff(rangeEnd, rangeStart) + 1;
  const gridWidth = totalDays * PX_PER_DAY;

  // Drag-to-reschedule. The hook owns pointer listeners + an override
  // map so the active drag renders optimistically; on pointerup it
  // calls updateCard() and the realtime echo (useWorkloadSync) will
  // rerender with the saved span.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const drag = useWorkloadDrag(scrollerRef, PX_PER_DAY);

  // Apply optimistic overrides on top of server-provided cards so
  // packing, histogram math, and bar positions all reflect the
  // in-flight drag.
  const cardsWithOverrides = useMemo(() => {
    if (drag.overrides.size === 0) return cards;
    return cards.map((c) => {
      const o = drag.overrides.get(c.id);
      if (!o) return c;
      return { ...c, startDate: o.startDate, targetDate: o.targetDate };
    });
  }, [cards, drag.overrides]);

  const filtered = useMemo(() => {
    return cardsWithOverrides.filter((c) => {
      if (wsFilter && c.workspaceId !== wsFilter) return false;
      if (sprintFilter && c.sprintId !== sprintFilter) return false;
      if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
      if (completedFilter === "hide" && c.completedAt != null) return false;
      // Visible if span intersects range.
      if (c.targetDate < rangeStart || c.startDate > rangeEnd) return false;
      return true;
    });
  }, [
    cardsWithOverrides,
    wsFilter,
    sprintFilter,
    priorityFilter,
    completedFilter,
    rangeStart,
    rangeEnd,
  ]);

  const workspaces = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) m.set(c.workspaceId, c.workspaceName);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [cards]);

  const sprintsAvail = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) {
      if (c.sprintId && c.sprintName) m.set(c.sprintId, c.sprintName);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [cards]);

  const profileById = useMemo(() => {
    const m = new Map<string, WorkloadProfile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  // Group filtered cards by lane key. In user mode each card lands in
  // exactly the lane it was emitted for (owner / member rows, see
  // listWorkload). In workspace mode we collapse to one lane per
  // workspace, deduping per cardId so a card shared by two members
  // doesn't double-count toward the lane's load or histogram.
  const grouped = useMemo(() => {
    const m = new Map<string, WorkloadCard[]>();
    if (lanesMode === "workspace") {
      const seen = new Map<string, Set<string>>();
      for (const c of filtered) {
        let cardSet = seen.get(c.workspaceId);
        if (!cardSet) {
          cardSet = new Set();
          seen.set(c.workspaceId, cardSet);
        }
        if (cardSet.has(c.id)) continue;
        cardSet.add(c.id);
        const arr = m.get(c.workspaceId);
        if (arr) arr.push(c);
        else m.set(c.workspaceId, [c]);
      }
    } else {
      for (const c of filtered) {
        const arr = m.get(c.userId);
        if (arr) arr.push(c);
        else m.set(c.userId, [c]);
      }
    }
    return m;
  }, [filtered, lanesMode]);

  const lanes = useMemo(() => {
    const arr = Array.from(grouped.entries()).map(([key, lcards]) => {
      const packed = packLanes(lcards);
      const rows = Math.max(1, ...packed.map((p) => p.row + 1));
      // Per-lane week buckets across the visible range. Reuses the pure
      // helpers in lib/workload/buckets.ts.
      const buckets = fillBuckets(
        bucketsBetween(rangeStart, rangeEnd),
        lcards.map((c) => ({
          id: c.id,
          startDate: c.startDate,
          targetDate: c.targetDate,
          estimateMin: c.estimateMin,
        })),
      );
      // Capacity line is meaningful only when at least one card has a
      // real estimate. Otherwise the histogram uses synthetic "card-frac"
      // units that don't correspond to minutes.
      const hasEstimate = lcards.some((c) => c.estimateMin != null);
      // Capacity multiplier: in user mode it's 1× the weekly cap; in
      // workspace mode it scales with the number of distinct users
      // touching cards in this workspace within the visible range, so a
      // 5-person workspace gets a 5×40h ceiling.
      const distinctUsers =
        lanesMode === "workspace"
          ? new Set(lcards.map((c) => c.userId)).size
          : 1;
      const laneCapacity = WEEKLY_CAPACITY_MIN * Math.max(1, distinctUsers);
      const isOver = hasEstimate
        ? buckets.some((b) => b.load > laneCapacity)
        : false;
      // Peak load drives histogram bar heights. Floor at the capacity
      // line so the threshold is always rendered at a sensible y-coord
      // even when the lane is underloaded.
      const peakLoad = Math.max(
        laneCapacity,
        ...buckets.map((b) => b.load),
        1,
      );
      let name: string;
      let handle: string | null = null;
      let avatarUrl: string | null = null;
      if (lanesMode === "workspace") {
        // Lane label uses the workspaceName captured on any card in the
        // group (all cards in a lane share workspaceId, so any will do).
        name = lcards[0]?.workspaceName ?? "Unknown workspace";
      } else {
        const profile = profileById.get(key);
        name = profile?.displayName ?? "Unknown";
        handle = profile?.handle ?? null;
        avatarUrl = profile?.avatarUrl ?? null;
      }
      return {
        laneKey: key,
        // Keep `userId` for the user-mode owner-link below; in workspace
        // mode this is unused.
        userId: lanesMode === "user" ? key : null,
        name,
        handle,
        avatarUrl,
        cards: lcards,
        packed,
        rows,
        buckets,
        hasEstimate,
        isOver,
        peakLoad,
        laneCapacity,
        distinctUsers,
        peak: Math.max(
          ...lcards.map((c) =>
            c.estimateMin ?? (c.storyPoints ? c.storyPoints * 60 : 60),
          ),
        ),
        load: lcards.reduce(
          (acc, c) =>
            acc +
            (c.estimateMin ?? (c.storyPoints ? c.storyPoints * 60 : 60)),
          0,
        ),
      };
    });
    if (sortKind === "peak") arr.sort((a, b) => b.load - a.load);
    else arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [grouped, profileById, sortKind, rangeStart, rangeEnd, lanesMode]);

  function xFor(d: Date): number {
    const clamped = d < rangeStart ? rangeStart : d > rangeEnd ? rangeEnd : d;
    return dayDiff(clamped, rangeStart) * PX_PER_DAY;
  }
  function widthFor(card: WorkloadCard): number {
    const left = xFor(card.startDate);
    const right = xFor(addDays(card.targetDate, 1));
    return Math.max(PX_PER_DAY, right - left);
  }

  // Day header cells: render each day, decorate Mondays / months / today.
  const dayCells = useMemo(() => {
    const out: { date: Date; index: number }[] = [];
    for (let i = 0; i < totalDays; i++) {
      out.push({ date: addDays(rangeStart, i), index: i });
    }
    return out;
  }, [rangeStart, totalDays]);

  const todayX = today >= rangeStart && today <= rangeEnd ? xFor(today) : null;

  return (
    <section className="space-y-4" data-testid="workload-view">
      <WorkloadToolbar
        workspaces={workspaces}
        sprints={sprintsAvail}
        totalCards={cards.length}
        wsFilter={wsFilter}
        setWsFilter={setWsFilter}
        sprintFilter={sprintFilter}
        setSprintFilter={setSprintFilter}
        rangePreset={rangePreset}
        setRangePreset={setRangePreset}
        sortKind={sortKind}
        setSortKind={setSortKind}
        lanesMode={lanesMode}
        setLanesMode={setLanesMode}
      />

      {/* Filter chip row — priority + completed. Persisted in URL params
          (?prio, ?done) for shareability. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="mono-meta-sm text-fg-faint">PRIORITY</span>
          <Select
            value={priorityFilter}
            onValueChange={(v) => setPriorityFilter(v as PriorityFilter)}
            data-testid="workload-priority-filter"
            options={[
              { value: "all", label: "ALL" },
              { value: "p0", label: "P0" },
              { value: "p1", label: "P1" },
              { value: "p2", label: "P2" },
              { value: "p3", label: "P3" },
              { value: "p4", label: "P4" },
            ]}
            size="sm"
            className="min-w-24"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="mono-meta-sm text-fg-faint">COMPLETED</span>
          <Select
            value={completedFilter}
            onValueChange={(v) => setCompletedFilter(v as CompletedFilter)}
            data-testid="workload-completed-filter"
            options={[
              { value: "hide", label: "HIDE COMPLETED" },
              { value: "show", label: "SHOW COMPLETED" },
            ]}
            size="sm"
            className="min-w-40"
          />
        </label>
      </div>

      {lanes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-hi p-12 text-center">
          <p className="mono-meta text-fg-muted">NO SCHEDULED WORK</p>
          <p className="text-sm text-fg-faint mt-2 max-w-sm mx-auto">
            Cards land here once they have start + target dates and an owner
            or assignees.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-hairline overflow-hidden">
          <div
            ref={scrollerRef}
            className="overflow-x-auto"
            style={{ position: "relative" }}
          >
            <div style={{ width: LANE_LABEL_WIDTH + gridWidth, minWidth: "100%" }}>
              {/* Month strip */}
              <div
                className="sticky top-0 z-20 flex border-b border-hairline bg-[color:var(--surface-strong)] backdrop-blur-sm"
                style={{ height: 22 }}
              >
                <div
                  className="shrink-0 border-r border-hairline px-3 mono-meta-sm text-fg-faint flex items-center"
                  style={{ width: LANE_LABEL_WIDTH }}
                >
                  {lanesMode === "workspace" ? "WORKSPACE" : "PERSON"}
                </div>
                <div className="relative flex-1" style={{ width: gridWidth }}>
                  {monthRuns(dayCells).map((run) => {
                    const runWidth = run.length * PX_PER_DAY;
                    // Hide the month label when the run is too narrow to
                    // fit it without overlapping the next month's label.
                    // ~36px buys "APR" + padding; below that, keep the
                    // boundary line and drop the text.
                    const showLabel = runWidth >= 36;
                    return (
                      <div
                        key={run.start}
                        className="absolute inset-y-0 mono-meta-sm text-fg-muted flex items-center overflow-hidden border-l border-hairline first:border-l-0"
                        style={{
                          left: run.start * PX_PER_DAY,
                          width: runWidth,
                          paddingLeft: showLabel ? 8 : 0,
                        }}
                      >
                        {showLabel && (
                          <span className="truncate">
                            {fmtMonthShort(addDays(rangeStart, run.start))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Day-tick strip */}
              <div
                className="sticky z-10 flex border-b border-hairline bg-[color:var(--surface)]"
                style={{ top: 22, height: 18 }}
              >
                <div
                  className="shrink-0 border-r border-hairline"
                  style={{ width: LANE_LABEL_WIDTH }}
                />
                <div className="relative" style={{ width: gridWidth }}>
                  {dayCells.map((c) => {
                    const dow = dayName(c.date);
                    const isMonday = dow === 1;
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <div
                        key={c.index}
                        className="absolute inset-y-0"
                        style={{
                          left: c.index * PX_PER_DAY,
                          width: PX_PER_DAY,
                          background: isWeekend
                            ? "rgb(255 255 255 / 0.04)"
                            : undefined,
                          borderLeft: isMonday
                            ? "1px solid var(--hairline)"
                            : undefined,
                        }}
                      >
                        {isMonday && (
                          <span className="absolute top-0.5 left-1 mono-meta-sm text-fg-faint tabular-nums">
                            {c.date.getUTCDate()}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {todayX !== null && (
                    <span
                      aria-label="Today"
                      className="absolute top-0 bottom-0 z-10 pointer-events-none"
                      style={{
                        left: todayX,
                        width: 1,
                        background: "rgb(250 250 250 / 0.45)",
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Lanes */}
              {lanes.map((u) => {
                const barsHeight =
                  u.rows * LANE_BAR_HEIGHT + (u.rows - 1) * 4 + LANE_PADDING_Y * 2;
                const laneHeight = HISTO_HEIGHT + barsHeight;
                // y-coord of the capacity line, measured from the top of
                // the histogram strip. In user mode this is 40h; in
                // workspace mode it scales with the number of distinct
                // users in that workspace touching the timeline.
                const capacityY =
                  HISTO_HEIGHT - (u.laneCapacity / u.peakLoad) * HISTO_HEIGHT;
                // Tooltip surfaces the specific weeks that broke
                // capacity so the chip becomes a one-glance diagnostic
                // instead of a generic "you're over" badge. Format
                // matches the histogram label convention (e.g. W18).
                const overWeeksLabel = u.buckets
                  .filter((b) => b.load > u.laneCapacity)
                  .map((b) => `W${b.isoWeek}`)
                  .join(", ");
                const overTitle = (() => {
                  const base =
                    lanesMode === "workspace"
                      ? `At least one week exceeds ${u.distinctUsers}× 40h capacity`
                      : "At least one week exceeds 40h capacity";
                  return overWeeksLabel
                    ? `${base}: ${overWeeksLabel}`
                    : base;
                })();
                const labelInner = (
                  <>
                    <span
                      aria-hidden
                      className="size-7 shrink-0 rounded-full bg-[color:var(--surface-strong)] border border-hairline-hi text-fg-muted text-[10px] font-mono flex items-center justify-center uppercase tabular-nums"
                    >
                      {u.name
                        .split(/\s+/)
                        .map((s) => s[0])
                        .join("")
                        .slice(0, 2) || "?"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="block text-sm font-medium text-fg truncate">
                          {u.name}
                        </span>
                        {u.isOver && (
                          <span
                            data-testid="workload-lane-over-chip"
                            className="shrink-0 mono-meta-sm px-1 py-px rounded text-[10px] font-medium tracking-wide"
                            style={{
                              background:
                                "color-mix(in oklab, var(--accent-magenta) 28%, transparent)",
                              color: "var(--accent-magenta)",
                              border:
                                "1px solid color-mix(in oklab, var(--accent-magenta) 55%, transparent)",
                            }}
                            title={overTitle}
                          >
                            OVER
                          </span>
                        )}
                      </span>
                      <span className="block mono-meta-sm text-fg-faint truncate">
                        {u.cards.length}{" "}
                        {u.cards.length === 1 ? "CARD" : "CARDS"}
                        {lanesMode === "workspace" && u.distinctUsers > 0 &&
                          ` · ${u.distinctUsers} ${u.distinctUsers === 1 ? "USER" : "USERS"}`}
                        {u.load > 0 &&
                          ` · ${u.load >= 60 ? `${Math.round(u.load / 60)}H` : `${u.load}M`}`}
                      </span>
                    </span>
                  </>
                );
                return (
                  <div
                    key={u.laneKey}
                    className="flex border-b border-hairline last:border-b-0 hover:bg-[color:var(--surface)] transition-colors"
                    data-testid="workload-lane"
                    data-lane-mode={lanesMode}
                    data-lane-key={u.laneKey}
                    data-user-id={u.userId ?? undefined}
                    data-workspace-id={
                      lanesMode === "workspace" ? u.laneKey : undefined
                    }
                    data-over-capacity={u.isOver ? "true" : "false"}
                  >
                    {lanesMode === "workspace" ? (
                      <Link
                        href={`/w/${u.laneKey}/all-tasks`}
                        className="shrink-0 border-r border-hairline px-3 py-2 flex items-center gap-2.5 hover:bg-[color:var(--surface-strong)] transition-colors"
                        style={{ width: LANE_LABEL_WIDTH }}
                        title={`Open ${u.name}'s tasks`}
                      >
                        {labelInner}
                      </Link>
                    ) : (
                      <Link
                        href={`/all-tasks?owner=${u.userId}`}
                        className="shrink-0 border-r border-hairline px-3 py-2 flex items-center gap-2.5 hover:bg-[color:var(--surface-strong)] transition-colors"
                        style={{ width: LANE_LABEL_WIDTH }}
                        title={`Open ${u.name}'s tasks`}
                      >
                        {labelInner}
                      </Link>
                    )}
                    <div
                      className="relative flex-1"
                      style={{ width: gridWidth, height: laneHeight }}
                    >
                      {/* Weekend wash + today line repeat per lane so they
                          read at any vertical scroll position.  Weekend wash
                          handled at the day strip via background; here only
                          today line. */}
                      {todayX !== null && (
                        <span
                          aria-hidden
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{
                            left: todayX,
                            width: 1,
                            background: "rgb(250 250 250 / 0.20)",
                          }}
                        />
                      )}
                      {/* Weekend wash strips */}
                      {dayCells.map((c) => {
                        const dow = dayName(c.date);
                        if (dow !== 0 && dow !== 6) return null;
                        return (
                          <span
                            key={`we-${c.index}`}
                            aria-hidden
                            className="absolute top-0 bottom-0 pointer-events-none"
                            style={{
                              left: c.index * PX_PER_DAY,
                              width: PX_PER_DAY,
                              background: "rgb(255 255 255 / 0.025)",
                            }}
                          />
                        );
                      })}
                      {/* Per-lane histogram strip — sits atop the bars and
                          shows weekly load. Bars tint magenta when they
                          exceed 40h, otherwise violet. */}
                      <div
                        className="absolute inset-x-0 top-0 border-b border-hairline/50"
                        style={{ height: HISTO_HEIGHT }}
                        data-testid="workload-lane-histogram"
                      >
                        {u.buckets.map((b) => {
                          const left =
                            ((b.start.getTime() - rangeStart.getTime()) /
                              MS_DAY) *
                            PX_PER_DAY;
                          const width = 7 * PX_PER_DAY;
                          if (b.load <= 0) return null;
                          const h = Math.max(
                            1,
                            (b.load / u.peakLoad) * (HISTO_HEIGHT - 2),
                          );
                          const isBucketOver =
                            u.hasEstimate && b.load > u.laneCapacity;
                          return (
                            <span
                              key={`${u.laneKey}-${b.isoYear}-${b.isoWeek}`}
                              aria-hidden
                              data-over={isBucketOver ? "true" : "false"}
                              className="absolute bottom-0"
                              style={{
                                left: left + 1,
                                width: Math.max(2, width - 2),
                                height: h,
                                background: isBucketOver
                                  ? "color-mix(in oklab, var(--accent-magenta) 55%, transparent)"
                                  : "color-mix(in oklab, var(--accent-violet) 45%, transparent)",
                              }}
                              title={`Week ${b.isoWeek}: ${
                                u.hasEstimate
                                  ? `${Math.round(b.load)}m (${(b.load / 60).toFixed(1)}h)`
                                  : `${b.load.toFixed(2)} card-frac`
                              }`}
                            />
                          );
                        })}
                        {/* 40h capacity line — only drawn when at least
                            one card in the lane has an estimate, since
                            otherwise the histogram is in synthetic units
                            and the threshold isn't comparable. */}
                        {u.hasEstimate && capacityY >= 0 && (
                          <span
                            aria-hidden
                            data-testid="workload-lane-capacity-line"
                            className="absolute left-0 right-0 pointer-events-none"
                            style={{
                              top: capacityY,
                              height: 1,
                              borderTop:
                                "1px dashed color-mix(in oklab, var(--accent-magenta) 60%, transparent)",
                            }}
                          />
                        )}
                      </div>
                      {/* Card bars sit below the histogram strip. */}
                      {u.packed.map(({ card, row }) => {
                        const barTop =
                          HISTO_HEIGHT +
                          LANE_PADDING_Y +
                          row * (LANE_BAR_HEIGHT + 4);
                        const isActive =
                          drag.activeTick !== null &&
                          drag.activeTick.cardId === card.id;
                        return (
                          <Fragment key={`${card.id}-${card.userId}`}>
                            <WorkloadBar
                              card={card}
                              x={xFor(card.startDate)}
                              width={widthFor(card)}
                              top={barTop}
                              height={LANE_BAR_HEIGHT}
                              onBeginDrag={(mode, e) =>
                                drag.beginDrag(mode, e, card.id, {
                                  startDate: card.startDate,
                                  targetDate: card.targetDate,
                                })
                              }
                              isDraggingActive={isActive}
                              isAnyDragInFlight={drag.isDragging}
                            />
                            {isActive && drag.activeTick && (
                              <span
                                aria-hidden
                                data-testid="workload-drag-tick"
                                className="absolute pointer-events-none mono-meta-sm text-fg-faint tabular-nums whitespace-nowrap"
                                style={{
                                  left: xFor(card.startDate),
                                  top: barTop + LANE_BAR_HEIGHT + 2,
                                  zIndex: 26,
                                }}
                              >
                                {drag.activeTick.startISO}
                                {" → "}
                                {drag.activeTick.targetISO}
                              </span>
                            )}
                          </Fragment>
                        );
                      })}
                      {u.cards.length === 0 && (
                        <span className="absolute inset-0 flex items-center justify-center mono-meta-sm text-fg-faint">
                          NO LOAD THIS RANGE
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <p className="mono-meta-sm text-fg-faint">
        FILLED = OWNER · OUTLINED = COLLAB · STATUS COLOR = LIST STATUS · LEFT
        STRIPE = P0 / P1
      </p>
    </section>
  );
}

// Group consecutive day-cells by month so the month strip renders
// "JUN ─── JUL ───── AUG" with one tag per run.
function monthRuns(
  cells: { date: Date; index: number }[],
): { start: number; length: number; month: number }[] {
  const out: { start: number; length: number; month: number }[] = [];
  if (cells.length === 0) return out;
  let runStart = 0;
  let runMonth = cells[0].date.getUTCMonth();
  for (let i = 1; i < cells.length; i++) {
    const m = cells[i].date.getUTCMonth();
    if (m !== runMonth) {
      out.push({ start: runStart, length: i - runStart, month: runMonth });
      runStart = i;
      runMonth = m;
    }
  }
  out.push({
    start: runStart,
    length: cells.length - runStart,
    month: runMonth,
  });
  return out;
}
