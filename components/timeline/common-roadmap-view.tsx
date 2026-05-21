"use client";
/**
 * Cross-workspace roadmap (gantt) view for /timeline.
 *
 * Flat chronological list across every workspace the viewer can see, sorted
 * by start date ascending. Each row carries its own WORKSPACE · BOARD
 * breadcrumb in the rail, followed by the card title, so the workspace
 * column travels per row instead of as a collapsible band. Bar grammar is
 * a quiet pill with a priority stripe + completed hatch; drag, deps, and
 * milestones are intentionally absent — this surface is read-mostly.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { CrossWorkspaceCard } from "@/lib/queries/cards";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

type Props = {
  cards: CrossWorkspaceCard[];
};

type Zoom = "W" | "M" | "Q";

const DAY_PX: Record<Zoom, number> = { W: 22, M: 10, Q: 4 };
const RAIL_W = 280;
const ROW_H = 44;
const BAR_H = 22;
const STORAGE_KEY_ZOOM = "common-roadmap:zoom";
const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function midnight(d: Date | string): Date {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (midnight(b).getTime() - midnight(a).getTime()) / DAY_MS,
  );
}

function startOfWeekMon(d: Date): Date {
  const x = midnight(d);
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}

type Range = { start: Date; end: Date; days: number };

const ZOOM_WINDOW: Record<Zoom, { before: number; after: number }> = {
  W: { before: 14, after: 70 },
  M: { before: 30, after: 120 },
  Q: { before: 60, after: 365 },
};

function computeRange(cards: CrossWorkspaceCard[], zoom: Zoom): Range {
  const today = midnight(new Date());
  const win = ZOOM_WINDOW[zoom];
  let start = startOfWeekMon(addDays(today, -win.before));
  let end = addDays(startOfWeekMon(addDays(today, win.after)), 7);
  for (const c of cards) {
    const s = midnight(c.startDate);
    const t = midnight(c.targetDate);
    if (s < start) start = startOfWeekMon(s);
    if (t > end) end = addDays(startOfWeekMon(t), 7);
  }
  return { start, end, days: daysBetween(start, end) };
}

/** Stable flat ordering: startDate ASC, then workspace name, then title. The
 *  query already orders by startDate ASC, but cards arriving with identical
 *  start dates from different workspaces are otherwise indeterminate, and
 *  the rail breadcrumb has no visual grouping to fall back on. */
function sortCardsByTime(cards: CrossWorkspaceCard[]): CrossWorkspaceCard[] {
  return [...cards].sort((a, b) => {
    const da = midnight(a.startDate).getTime();
    const db = midnight(b.startDate).getTime();
    if (da !== db) return da - db;
    const ws = a.workspaceName.localeCompare(b.workspaceName);
    if (ws !== 0) return ws;
    return a.title.localeCompare(b.title);
  });
}

function useLocalStorage<T>(
  key: string,
  initial: T,
  serialize: (v: T) => string,
  deserialize: (raw: string) => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const serializeRef = useRef(serialize);
  const deserializeRef = useRef(deserialize);
  serializeRef.current = serialize;
  deserializeRef.current = deserialize;
  useLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(deserializeRef.current(raw));
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, serializeRef.current(v));
        } catch {
          /* ignore */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

function TimeAxis({
  range,
  dayPx,
  todayOffset,
}: {
  range: Range;
  dayPx: number;
  todayOffset: number | null;
}) {
  const canvasW = range.days * dayPx;
  const months: Array<{ label: string; left: number; width: number }> = [];
  let cursor = midnight(range.start);
  while (cursor < range.end) {
    const monthStart = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      1,
    );
    const monthEnd = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      1,
    );
    const visibleStart = monthStart < range.start ? range.start : monthStart;
    const visibleEnd = monthEnd > range.end ? range.end : monthEnd;
    const left = daysBetween(range.start, visibleStart) * dayPx;
    const width = daysBetween(visibleStart, visibleEnd) * dayPx;
    if (width > 0) {
      months.push({
        label: `${MONTHS[monthStart.getMonth()]} ${String(
          monthStart.getFullYear(),
        ).slice(2)}`,
        left,
        width,
      });
    }
    cursor = monthEnd;
  }

  const weekTicks: number[] = [];
  for (let d = 0; d <= range.days; d += 7) weekTicks.push(d * dayPx);

  return (
    <div
      className="sticky top-0 z-20 flex border-b border-hairline bg-[color:var(--bg-deep)]"
      style={{ minWidth: RAIL_W + canvasW }}
    >
      <div
        className="sticky left-0 z-30 shrink-0 border-r border-hairline bg-[color:var(--bg-deep)] mono-meta-sm text-fg-faint flex items-end px-3 pb-1.5"
        style={{ width: RAIL_W, height: 42 }}
      >
        WORKSPACE / BOARD / CARD
      </div>
      <div className="relative" style={{ width: canvasW, height: 42 }}>
        {months.map((m) => (
          <div
            key={`${m.label}-${m.left}`}
            className="absolute top-0 h-full border-l border-hairline"
            style={{ left: m.left, width: m.width }}
          >
            <div className="mono-meta-sm tracking-widest text-fg-muted px-2 pt-2">
              {m.label.toUpperCase()}
            </div>
          </div>
        ))}
        {weekTicks.map((x) => (
          <div
            key={`wt-${x}`}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-[rgb(255_255_255/0.05)]"
            style={{ left: x }}
          />
        ))}
        {todayOffset != null && (
          <div
            className="absolute top-0 bottom-0 z-10"
            style={{ left: todayOffset }}
          >
            <div className="absolute top-0 bottom-0 -translate-x-1/2 w-px bg-fg/60" />
            <div className="absolute top-0 left-0 -translate-x-1/2 mono-meta-sm tracking-widest text-fg bg-[color:var(--bg-deep)] px-1 pt-0.5">
              TODAY
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GanttBar({
  card,
  range,
  dayPx,
  onOpen,
}: {
  card: CrossWorkspaceCard;
  range: Range;
  dayPx: number;
  onOpen: (card: CrossWorkspaceCard) => void;
}) {
  const startOffset = Math.max(0, daysBetween(range.start, card.startDate));
  const span = Math.max(
    1,
    daysBetween(card.startDate, card.targetDate) + 1,
  );
  const left = startOffset * dayPx;
  const width = Math.max(8, span * dayPx);
  const priority = (card.priority ?? null) as CardPriority | null;
  const stripeClass = priority
    ? PRIORITY_TINT[priority].dot
    : "bg-transparent";
  const completed = card.completedAt != null;
  const fmt = (d: Date | string) => {
    const dt = midnight(d);
    return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  };
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      data-card-id={card.id}
      data-card-type={card.type}
      data-completed={completed ? "true" : undefined}
      className={[
        "absolute group/bar overflow-hidden rounded-md border text-left",
        "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/60",
        completed
          ? "bg-[rgb(255_255_255/0.04)] border-hairline text-fg-faint"
          : "bg-[rgb(255_255_255/0.085)] border-hairline-hi text-fg hover:bg-[rgb(255_255_255/0.12)]",
      ].join(" ")}
      style={{
        left,
        width,
        height: BAR_H,
        top: (ROW_H - BAR_H) / 2,
        ...(completed
          ? {
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent 0 2px, rgb(255 255 255 / 0.05) 2px 3px)",
            }
          : {}),
      }}
      title={`${card.title}\n${fmt(card.startDate)} → ${fmt(
        card.targetDate,
      )}\n${card.workspaceName} · ${card.boardTitle}`}
    >
      {priority && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 w-[3px] ${stripeClass}`}
        />
      )}
      <span
        className={[
          "block truncate pl-2 pr-2 leading-none text-xs",
          "h-full flex items-center",
          completed ? "line-through" : "",
        ].join(" ")}
        style={{ paddingLeft: priority ? 8 : 6 }}
      >
        {card.title}
      </span>
    </button>
  );
}

export function CommonRoadmapView({ cards }: Props) {
  const router = useRouter();
  const today = useMemo(() => midnight(new Date()), []);

  const sorted = useMemo(() => sortCardsByTime(cards), [cards]);

  const [zoom, setZoom] = useLocalStorage<Zoom>(
    STORAGE_KEY_ZOOM,
    "M",
    (v) => v,
    (raw) => (raw === "W" || raw === "M" || raw === "Q" ? raw : "M"),
  );
  const dayPx = DAY_PX[zoom];
  const range = useMemo(() => computeRange(cards, zoom), [cards, zoom]);
  const liveTodayOffset = useMemo(() => {
    if (today < range.start || today > range.end) return null;
    return daysBetween(range.start, today) * dayPx;
  }, [today, range, dayPx]);

  const workspaceCount = useMemo(() => {
    const s = new Set<string>();
    for (const c of sorted) s.add(c.workspaceId);
    return s.size;
  }, [sorted]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const jumpToToday = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || liveTodayOffset == null) return;
    const target = RAIL_W + liveTodayOffset - el.clientWidth * 0.35;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [liveTodayOffset]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || liveTodayOffset == null) return;
    const target = RAIL_W + liveTodayOffset - el.clientWidth * 0.35;
    el.scrollLeft = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCard = useCallback(
    (card: CrossWorkspaceCard) => {
      router.push(`/b/${card.boardId}/c/${card.id}`);
    },
    [router],
  );

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-xl border border-hairline p-10 text-center text-fg-muted"
        data-testid="common-roadmap-empty"
      >
        <p className="mono-meta">No scheduled cards</p>
        <p className="text-sm mt-1">
          Cards appear here once they have both a start and target date.
        </p>
      </div>
    );
  }

  const canvasW = range.days * dayPx;
  const trackMinW = RAIL_W + canvasW;

  return (
    <div
      className="rounded-xl border border-hairline overflow-hidden bg-[color:var(--bg-deep)]"
      data-testid="common-roadmap-view"
    >
      {/* Masthead — zoom + today + counts */}
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="mono-meta-sm text-fg-faint tracking-widest">
          ZOOM
        </span>
        <div
          role="radiogroup"
          aria-label="Zoom"
          className="inline-flex rounded-md border border-hairline overflow-hidden"
        >
          {(["W", "M", "Q"] as Zoom[]).map((z) => {
            const active = zoom === z;
            return (
              <button
                key={z}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setZoom(z)}
                data-active={active ? "true" : undefined}
                className={[
                  "px-2.5 h-7 mono-meta-sm tracking-widest transition-colors",
                  active
                    ? "bg-fg text-bg-deep"
                    : "text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.04)]",
                ].join(" ")}
                title={
                  z === "W"
                    ? "Week (dense)"
                    : z === "M"
                      ? "Month"
                      : "Quarter (broad)"
                }
              >
                {z}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={jumpToToday}
          disabled={liveTodayOffset == null}
          className="ml-2 inline-flex items-center h-7 px-2.5 rounded-md border border-hairline mono-meta-sm tracking-widest text-fg-muted hover:text-fg hover:border-hairline-hi disabled:opacity-40 disabled:hover:text-fg-muted transition-colors"
        >
          TODAY
        </button>
        <span className="ml-auto mono-meta-sm tabular-nums text-fg-faint">
          {sorted.length} {sorted.length === 1 ? "CARD" : "CARDS"} ·{" "}
          {workspaceCount}{" "}
          {workspaceCount === 1 ? "WORKSPACE" : "WORKSPACES"}
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="overflow-auto"
        style={{ maxHeight: "calc(100vh - 240px)" }}
      >
        <div style={{ minWidth: trackMinW }}>
          <TimeAxis
            range={range}
            dayPx={dayPx}
            todayOffset={liveTodayOffset}
          />

          {sorted.map((card) => {
            const completed = card.completedAt != null;
            return (
              <div
                key={card.id}
                className="flex group/row hover:bg-[rgb(255_255_255/0.025)] border-t border-hairline first:border-t-0"
                data-card-id={card.id}
                data-workspace-id={card.workspaceId}
                data-testid="common-roadmap-row"
              >
                <div
                  className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-[color:var(--bg-deep)] group-hover/row:bg-[rgb(20_20_20)] flex flex-col justify-center gap-0.5 px-3 transition-colors"
                  style={{ width: RAIL_W, height: ROW_H }}
                >
                  <div
                    className="flex items-center gap-1.5 mono-meta-sm text-fg-faint tracking-[0.14em] truncate"
                    title={`${card.workspaceName} · ${card.boardTitle}`}
                  >
                    <span className="truncate">
                      {card.workspaceName.toUpperCase()}
                    </span>
                    <span aria-hidden className="text-fg-faint/60">
                      /
                    </span>
                    <span className="truncate text-fg-muted">
                      {card.boardTitle.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openCard(card)}
                      className={[
                        "truncate text-left text-xs transition-colors hover:underline focus-visible:outline-none focus-visible:underline",
                        completed
                          ? "line-through text-fg-faint"
                          : "text-fg font-medium",
                      ].join(" ")}
                      title={card.title}
                    >
                      {card.title}
                    </button>
                    <span
                      className="ml-auto mono-meta-sm shrink-0 text-fg-faint chip"
                      data-card-type={card.type}
                    >
                      {card.type.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div
                  className="relative"
                  style={{ width: canvasW, height: ROW_H }}
                >
                  {liveTodayOffset != null && (
                    <div
                      aria-hidden
                      className="absolute top-0 bottom-0 w-px bg-fg/30"
                      style={{ left: liveTodayOffset }}
                    />
                  )}
                  <GanttBar
                    card={card}
                    range={range}
                    dayPx={dayPx}
                    onOpen={openCard}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
