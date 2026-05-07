"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkloadCard, WorkloadProfile } from "@/lib/queries/workload";
import { useWorkloadSync } from "@/hooks/use-workload-sync";
import {
  WorkloadToolbar,
  type RangePreset,
  type SortKind,
} from "./workload-toolbar";
import { WorkloadBar } from "./workload-bar";

const MS_DAY = 86_400_000;
const PX_PER_DAY = 14;
const LANE_LABEL_WIDTH = 200;
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
  if (preset === "4w") {
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

  const [wsFilter, setWsFilter] = useState("");
  const [sprintFilter, setSprintFilter] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("4w");
  const [sortKind, setSortKind] = useState<SortKind>("peak");

  const today = useMemo(() => startOfDayUtc(new Date()), []);
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => rangeFor(rangePreset, today),
    [rangePreset, today],
  );
  const totalDays = dayDiff(rangeEnd, rangeStart) + 1;
  const gridWidth = totalDays * PX_PER_DAY;

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (wsFilter && c.workspaceId !== wsFilter) return false;
      if (sprintFilter && c.sprintId !== sprintFilter) return false;
      // Visible if span intersects range.
      if (c.targetDate < rangeStart || c.startDate > rangeEnd) return false;
      return true;
    });
  }, [cards, wsFilter, sprintFilter, rangeStart, rangeEnd]);

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

  const byUser = useMemo(() => {
    const m = new Map<string, WorkloadCard[]>();
    for (const c of filtered) {
      const arr = m.get(c.userId);
      if (arr) arr.push(c);
      else m.set(c.userId, [c]);
    }
    return m;
  }, [filtered]);

  const lanes = useMemo(() => {
    const arr = Array.from(byUser.entries()).map(([uid, ucards]) => {
      const packed = packLanes(ucards);
      const rows = Math.max(1, ...packed.map((p) => p.row + 1));
      const profile = profileById.get(uid);
      return {
        userId: uid,
        name: profile?.displayName ?? "Unknown",
        handle: profile?.handle ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        cards: ucards,
        packed,
        rows,
        peak: Math.max(
          ...ucards.map((c) =>
            c.estimateMin ?? (c.storyPoints ? c.storyPoints * 60 : 60),
          ),
        ),
        load: ucards.reduce(
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
  }, [byUser, profileById, sortKind]);

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
      />

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
          <div className="overflow-x-auto" style={{ position: "relative" }}>
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
                  PERSON
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
                const laneHeight =
                  u.rows * LANE_BAR_HEIGHT + (u.rows - 1) * 4 + LANE_PADDING_Y * 2;
                return (
                  <div
                    key={u.userId}
                    className="flex border-b border-hairline last:border-b-0 hover:bg-[color:var(--surface)] transition-colors"
                    data-testid="workload-lane"
                    data-user-id={u.userId}
                  >
                    <Link
                      href={`/all-tasks?owner=${u.userId}`}
                      className="shrink-0 border-r border-hairline px-3 py-2 flex items-center gap-2.5 hover:bg-[color:var(--surface-strong)] transition-colors"
                      style={{ width: LANE_LABEL_WIDTH }}
                      title={`Open ${u.name}'s tasks`}
                    >
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
                        <span className="block text-sm font-medium text-fg truncate">
                          {u.name}
                        </span>
                        <span className="block mono-meta-sm text-fg-faint truncate">
                          {u.cards.length}{" "}
                          {u.cards.length === 1 ? "CARD" : "CARDS"}
                          {u.load > 0 &&
                            ` · ${u.load >= 60 ? `${Math.round(u.load / 60)}H` : `${u.load}M`}`}
                        </span>
                      </span>
                    </Link>
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
                      {u.packed.map(({ card, row }) => (
                        <WorkloadBar
                          key={`${card.id}-${card.userId}`}
                          card={card}
                          x={xFor(card.startDate)}
                          width={widthFor(card)}
                          top={
                            LANE_PADDING_Y + row * (LANE_BAR_HEIGHT + 4)
                          }
                          height={LANE_BAR_HEIGHT}
                        />
                      ))}
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
