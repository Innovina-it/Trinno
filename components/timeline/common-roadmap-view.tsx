"use client";
/**
 * Cross-workspace roadmap (gantt) view for /timeline.
 *
 * Each visible workspace renders as a collapsible swimlane band. Inside an
 * expanded band, cards group by board and lay out as horizontal bars on a
 * shared time axis. Bar grammar mirrors the per-workspace roadmap (pill +
 * priority stripe + completion hatch); we intentionally skip drag, deps,
 * and milestones — this surface is read-mostly.
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
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { CrossWorkspaceCard } from "@/lib/queries/cards";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

type Props = {
  cards: CrossWorkspaceCard[];
  /** Every workspace the viewer can see, including ones with zero scheduled
   *  cards — they still render as empty bands so the surface advertises
   *  their existence. */
  allWorkspaces?: Array<{ id: string; name: string }>;
};

type Zoom = "W" | "M" | "Q";

const DAY_PX: Record<Zoom, number> = { W: 22, M: 10, Q: 4 };
const RAIL_W = 260;
const ROW_H = 32;
const BAR_H = 22;
const SUMMARY_H = 18;
const STORAGE_KEY_OPEN = "common-roadmap:open-ws";
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

// Default window scales with zoom: Q shows ~13 months, M shows ~5 months,
// W shows ~3 months. Past/future split is roughly 1:4 so the bias sits on
// upcoming work. Range always expands to cover any cards outside the
// default window so nothing renders off-canvas.
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

type BoardLane = {
  boardId: string;
  boardTitle: string;
  rows: Row[];
};

type WorkspaceGroup = {
  workspaceId: string;
  workspaceName: string;
  totalCards: number;
  boards: BoardLane[];
};

type Row = { card: CrossWorkspaceCard; depth: 0 | 1 | 2 };

function buildRows(cards: CrossWorkspaceCard[]): Row[] {
  const byParent = new Map<string | null, CrossWorkspaceCard[]>();
  const byId = new Map<string, CrossWorkspaceCard>();
  for (const c of cards) {
    byId.set(c.id, c);
    const arr = byParent.get(c.parentCardId ?? null) ?? [];
    arr.push(c);
    byParent.set(c.parentCardId ?? null, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const ta = midnight(a.startDate).getTime();
      const tb = midnight(b.startDate).getTime();
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });
  }
  const top = byParent.get(null) ?? [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.parentCardId && !byId.has(c.parentCardId)) top.push(c);
  }
  const sorted = top
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => {
      const ae = (byParent.get(a.id)?.length ?? 0) > 0 ? 0 : 1;
      const be = (byParent.get(b.id)?.length ?? 0) > 0 ? 0 : 1;
      if (ae !== be) return ae - be;
      return (
        midnight(a.startDate).getTime() - midnight(b.startDate).getTime()
      );
    });
  const out: Row[] = [];
  function emit(card: CrossWorkspaceCard, depth: 0 | 1 | 2) {
    out.push({ card, depth });
    for (const ch of byParent.get(card.id) ?? []) {
      emit(ch, depth === 0 ? 1 : 2);
    }
  }
  for (const c of sorted) emit(c, 0);
  return out;
}

function groupCards(
  cards: CrossWorkspaceCard[],
  allWorkspaces?: Array<{ id: string; name: string }>,
): WorkspaceGroup[] {
  const byWs = new Map<string, WorkspaceGroup>();
  if (allWorkspaces) {
    for (const w of allWorkspaces) {
      byWs.set(w.id, {
        workspaceId: w.id,
        workspaceName: w.name,
        totalCards: 0,
        boards: [],
      });
    }
  }
  const byBoard = new Map<string, CrossWorkspaceCard[]>();
  for (const c of cards) {
    let ws = byWs.get(c.workspaceId);
    if (!ws) {
      ws = {
        workspaceId: c.workspaceId,
        workspaceName: c.workspaceName,
        totalCards: 0,
        boards: [],
      };
      byWs.set(c.workspaceId, ws);
    }
    ws.totalCards += 1;
    const arr = byBoard.get(c.boardId) ?? [];
    arr.push(c);
    byBoard.set(c.boardId, arr);
  }
  for (const [boardId, list] of byBoard) {
    const ws = byWs.get(list[0].workspaceId);
    if (!ws) continue;
    ws.boards.push({
      boardId,
      boardTitle: list[0].boardTitle,
      rows: buildRows(list),
    });
  }
  const out = [...byWs.values()];
  for (const ws of out) {
    ws.boards.sort((a, b) => a.boardTitle.localeCompare(b.boardTitle));
  }
  out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
  return out;
}

function useLocalStorage<T>(
  key: string,
  initial: T,
  serialize: (v: T) => string,
  deserialize: (raw: string) => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  // Refs let us read the latest serialize/deserialize without putting them in
  // effect deps. Inline arrows from callers would otherwise change identity
  // every render and re-fire the localStorage read each time — which, for
  // values like a fresh Set, never bails out and produces an infinite loop.
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

// Time axis: month labels + week ticks + today line.
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
  // Build month spans across the range.
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

  // Week ticks every 7 days.
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

function SummaryStrip({
  rows,
  range,
  dayPx,
}: {
  rows: Row[];
  range: Range;
  dayPx: number;
}) {
  const canvasW = range.days * dayPx;
  return (
    <div
      className="relative border-t border-hairline"
      style={{ width: canvasW, height: SUMMARY_H }}
    >
      {rows.map((r) => {
        const startOffset = Math.max(
          0,
          daysBetween(range.start, r.card.startDate),
        );
        const span = Math.max(
          1,
          daysBetween(r.card.startDate, r.card.targetDate) + 1,
        );
        return (
          <span
            key={r.card.id}
            aria-hidden
            className="absolute top-1.5 h-1.5 rounded-sm bg-[rgb(255_255_255/0.22)]"
            style={{
              left: startOffset * dayPx,
              width: Math.max(2, span * dayPx),
            }}
          />
        );
      })}
    </div>
  );
}

export function CommonRoadmapView({ cards, allWorkspaces }: Props) {
  const router = useRouter();
  const groups = useMemo(
    () => groupCards(cards, allWorkspaces),
    [cards, allWorkspaces],
  );
  const today = useMemo(() => midnight(new Date()), []);

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

  const [openWs, setOpenWs] = useLocalStorage<Set<string>>(
    STORAGE_KEY_OPEN,
    new Set<string>(),
    (v) => JSON.stringify([...v]),
    (raw) => {
      try {
        const arr = JSON.parse(raw);
        return new Set<string>(Array.isArray(arr) ? arr : []);
      } catch {
        return new Set<string>();
      }
    },
  );

  const toggleWs = useCallback(
    (id: string) => {
      setOpenWs((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setOpenWs],
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const jumpToToday = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || liveTodayOffset == null) return;
    const target = RAIL_W + liveTodayOffset - el.clientWidth * 0.35;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [liveTodayOffset]);

  // Auto-center on today on first paint.
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

  if (groups.length === 0) {
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
      {/* Masthead — zoom + today */}
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
          {cards.length} {cards.length === 1 ? "CARD" : "CARDS"} ·{" "}
          {groups.length} {groups.length === 1 ? "WORKSPACE" : "WORKSPACES"}
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

          {groups.map((ws) => {
            const open = openWs.has(ws.workspaceId);
            const allRows = ws.boards.flatMap((b) => b.rows);
            return (
              <section
                key={ws.workspaceId}
                data-testid={`common-roadmap-ws-${ws.workspaceId}`}
                data-open={open ? "true" : undefined}
                className="border-b border-hairline last:border-b-0"
              >
                {/* Band header */}
                <div className="flex bg-[color:var(--bg-1)]">
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-[color:var(--bg-1)]"
                    style={{ width: RAIL_W }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleWs(ws.workspaceId)}
                      aria-expanded={open}
                      data-testid={`common-roadmap-ws-toggle-${ws.workspaceId}`}
                      className="w-full h-9 flex items-center gap-2 px-3 text-left hover:bg-[rgb(255_255_255/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg/40"
                    >
                      <ChevronRight
                        aria-hidden
                        className={`size-3.5 text-fg-faint transition-transform ${open ? "rotate-90" : ""}`}
                      />
                      <span className="mono-meta-sm tracking-widest text-fg truncate">
                        {ws.workspaceName.toUpperCase()}
                      </span>
                      <span className="ml-auto mono-meta-sm tabular-nums text-fg-faint shrink-0">
                        {ws.totalCards}
                      </span>
                      <Link
                        href={`/w/${ws.workspaceId}/roadmap`}
                        onClick={(e) => e.stopPropagation()}
                        title="Open workspace roadmap"
                        aria-label={`Open ${ws.workspaceName} roadmap`}
                        className="shrink-0 text-fg-faint hover:text-fg transition-colors"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    </button>
                  </div>
                  <div
                    className="relative"
                    style={{ width: canvasW, height: 36 }}
                  >
                    {liveTodayOffset != null && (
                      <div
                        aria-hidden
                        className="absolute top-0 bottom-0 w-px bg-fg/30"
                        style={{ left: liveTodayOffset }}
                      />
                    )}
                    {!open && allRows.length > 0 && (
                      <SummaryStrip
                        rows={allRows}
                        range={range}
                        dayPx={dayPx}
                      />
                    )}
                  </div>
                </div>

                {/* Expanded body */}
                {open && ws.boards.length > 0 && (
                  <div>
                    {ws.boards.map((board) => (
                      <div key={board.boardId}>
                        {/* Board sub-header */}
                        <div className="flex bg-[color:var(--bg-2)] border-t border-hairline">
                          <div
                            className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-[color:var(--bg-2)] px-3 h-7 flex items-center gap-2"
                            style={{ width: RAIL_W }}
                          >
                            <span
                              aria-hidden
                              className="size-1 rounded-full bg-fg/40 shrink-0"
                            />
                            <Link
                              href={`/b/${board.boardId}`}
                              className="mono-meta-sm tracking-widest text-fg hover:text-fg-muted truncate"
                            >
                              {board.boardTitle}
                            </Link>
                          </div>
                          <div
                            className="relative"
                            style={{ width: canvasW, height: 28 }}
                          >
                            {liveTodayOffset != null && (
                              <div
                                aria-hidden
                                className="absolute top-0 bottom-0 w-px bg-fg/30"
                                style={{ left: liveTodayOffset }}
                              />
                            )}
                          </div>
                        </div>
                        {/* Card rows */}
                        {board.rows.map(({ card, depth }) => (
                          <div
                            key={card.id}
                            className="flex group/row hover:bg-[rgb(255_255_255/0.025)]"
                            data-card-id={card.id}
                            data-depth={depth}
                          >
                            <div
                              className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-[color:var(--bg-deep)] group-hover/row:bg-[rgb(20_20_20)] flex items-center gap-2 pr-2 transition-colors"
                              style={{
                                width: RAIL_W,
                                height: ROW_H,
                                paddingLeft: 12 + depth * 14,
                              }}
                            >
                              {depth > 0 && (
                                <span
                                  aria-hidden
                                  className="size-1 rounded-full bg-fg-faint shrink-0"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => openCard(card)}
                                className={[
                                  "truncate text-left text-xs transition-colors hover:underline focus-visible:outline-none focus-visible:underline",
                                  depth === 0
                                    ? "text-fg font-medium"
                                    : "text-fg-muted hover:text-fg",
                                  card.completedAt
                                    ? "line-through text-fg-faint"
                                    : "",
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
                            <div
                              className="relative border-t border-hairline"
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
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
