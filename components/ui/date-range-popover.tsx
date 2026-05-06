"use client";
import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";

// Studio-Console date range picker. Replaces the native <input type="date">
// pair, matching DESIGN.md popover surface, mono-meta, hairline tokens.

export type DateRange = { start: Date | null; target: Date | null };

const MS_DAY = 86_400_000;
const PRESETS: { label: string; days: number }[] = [
  { label: "1W", days: 7 },
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "1Q", days: 90 },
];

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DAY);
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}
function fmtChip(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}
function fmtDuration(days: number): string {
  if (days < 7) return `${days}d`;
  const w = Math.round(days / 7);
  if (w < 9) return `${w}w`;
  const m = Math.round(days / 30);
  return `${m}mo`;
}

function buildMonth(anchor: Date): { day: Date; inMonth: boolean }[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  // Grid starts on Monday.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = addDaysUTC(first, -lead);
  const cells: { day: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDaysUTC(start, i);
    cells.push({ day, inMonth: day.getUTCMonth() === anchor.getUTCMonth() });
  }
  return cells;
}

export function DateRangePopover({
  value,
  onChange,
  disabled,
  triggerLabel = "Set dates",
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const today = startOfDayUTC(new Date());
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Date>(() =>
    new Date(Date.UTC((value.start ?? today).getUTCFullYear(), (value.start ?? today).getUTCMonth(), 1)),
  );
  // Two-step selection: first click sets start, second sets target.
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [hover, setHover] = useState<Date | null>(null);
  const [focusDay, setFocusDay] = useState<Date>(() => startOfDayUTC(value.start ?? new Date()));
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Re-sync internal state when the popover opens.
  useEffect(() => {
    if (!open) return;
    setPicking("start");
    setHover(null);
    const seed = value.start ?? today;
    setAnchor(new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1)));
    setFocusDay(seed);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(next: DateRange) {
    onChange(next);
  }

  function pickDay(d: Date) {
    if (picking === "start") {
      commit({ start: d, target: null });
      setPicking("end");
      return;
    }
    // Second click: ensure start <= target.
    const s = value.start ?? d;
    const a = s.getTime() <= d.getTime() ? s : d;
    const b = s.getTime() <= d.getTime() ? d : s;
    commit({ start: a, target: b });
    setPicking("start");
    setOpen(false);
  }

  function applyPreset(days: number) {
    const start = today;
    const target = addDaysUTC(start, days);
    commit({ start, target });
    setOpen(false);
  }

  function clear() {
    commit({ start: null, target: null });
    setPicking("start");
  }

  function nudgeFocus(deltaDays: number) {
    const next = addDaysUTC(focusDay, deltaDays);
    setFocusDay(next);
    if (
      next.getUTCFullYear() !== anchor.getUTCFullYear() ||
      next.getUTCMonth() !== anchor.getUTCMonth()
    ) {
      setAnchor(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1)));
    }
  }

  function onGridKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") { e.preventDefault(); nudgeFocus(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); nudgeFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); nudgeFocus(-7); }
    else if (e.key === "ArrowDown") { e.preventDefault(); nudgeFocus(7); }
    else if (e.key === "Enter") { e.preventDefault(); pickDay(focusDay); }
    else if (e.key.toLowerCase() === "t") { e.preventDefault(); nudgeFocus(diffDays(focusDay, today)); }
  }

  // Range preview: while picking the second day, show start..hover.
  const previewStart = picking === "end" ? value.start : null;
  const previewEnd = picking === "end" ? hover : null;

  function inRange(d: Date): boolean {
    const s = previewStart ?? value.start;
    const e = previewEnd ?? value.target;
    if (!s || !e) return false;
    return d.getTime() >= Math.min(s.getTime(), e.getTime()) &&
           d.getTime() <= Math.max(s.getTime(), e.getTime());
  }
  function isEdge(d: Date): "start" | "end" | null {
    const s = previewStart ?? value.start;
    const e = previewEnd ?? value.target;
    if (s && isSameDay(d, s)) return "start";
    if (e && isSameDay(d, e)) return "end";
    return null;
  }

  const cells = buildMonth(anchor);
  const cellsNext = buildMonth(addDaysUTC(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)), 0));

  // Trigger label: "Jun 1 — Jul 14 · 6w" or empty-state.
  const triggerText = (() => {
    if (value.start && value.target) {
      const d = diffDays(value.start, value.target);
      return `${fmtChip(value.start)} — ${fmtChip(value.target)} · ${fmtDuration(d)}`;
    }
    if (value.start) return `${fmtChip(value.start)} —`;
    if (value.target) return `— ${fmtChip(value.target)}`;
    return triggerLabel;
  })();

  const isEmpty = !value.start && !value.target;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        data-testid="date-range-trigger"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-hairline-hi bg-[color:var(--surface)] text-fg hover:bg-[color:var(--surface-strong)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 font-mono text-[0.8rem] tabular-nums"
      >
        <CalendarRange className="size-3.5 text-fg-muted" aria-hidden />
        <span className={isEmpty ? "text-fg-faint" : undefined}>{triggerText}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start">
          <Popover.Popup
            className="w-[640px] max-w-[calc(100vw-2rem)] rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-3 shadow-[0_40px_100px_-32px_rgba(0,0,0,0.6)] outline-none"
            onKeyDown={onGridKey}
          >
            {/* Preset row */}
            <div className="flex items-center gap-1.5 mb-3 px-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.days)}
                  className="chip mono-meta-sm px-2 py-1 hover:bg-[color:var(--surface-hi)] hover:text-fg"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setAnchor(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
                  setFocusDay(today);
                }}
                className="chip mono-meta-sm px-2 py-1 hover:bg-[color:var(--surface-hi)] hover:text-fg"
                title="Jump focus to today (T)"
              >
                TODAY
              </button>
              <span className="ml-auto mono-meta-sm text-fg-faint">
                {picking === "start" ? "PICK START" : "PICK TARGET"}
              </span>
              {!isEmpty && (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear dates"
                  className="size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Two-month grid */}
            <div ref={gridRef} className="grid grid-cols-2 gap-3">
              {[anchor, new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1))].map(
                (m, mi) => (
                  <MonthGrid
                    key={mi}
                    anchor={m}
                    cells={mi === 0 ? cells : cellsNext}
                    today={today}
                    focusDay={focusDay}
                    inRange={inRange}
                    isEdge={isEdge}
                    onPick={pickDay}
                    onHover={setHover}
                    onPrev={mi === 0 ? () => setAnchor(addMonths(anchor, -1)) : undefined}
                    onNext={mi === 1 ? () => setAnchor(addMonths(anchor, 1)) : undefined}
                  />
                ),
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function MonthGrid({
  anchor,
  cells,
  today,
  focusDay,
  inRange,
  isEdge,
  onPick,
  onHover,
  onPrev,
  onNext,
}: {
  anchor: Date;
  cells: { day: Date; inMonth: boolean }[];
  today: Date;
  focusDay: Date;
  inRange: (d: Date) => boolean;
  isEdge: (d: Date) => "start" | "end" | null;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        {onPrev ? (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        ) : (
          <span className="size-6" />
        )}
        <span className="mono-meta text-fg">{fmtMonth(anchor).toUpperCase()}</span>
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center"
          >
            <ChevronRight className="size-3.5" />
          </button>
        ) : (
          <span className="size-6" />
        )}
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="mono-meta-sm text-fg-faint py-1">
            {d}
          </span>
        ))}
        {cells.map(({ day, inMonth }) => {
          const edge = isEdge(day);
          const ranged = inRange(day);
          const isToday = isSameDay(day, today);
          const isFocus = isSameDay(day, focusDay);
          const base = "size-7 inline-flex items-center justify-center text-[0.78rem] font-mono tabular-nums transition-colors rounded-md";
          let cls = base;
          if (!inMonth) cls += " text-fg-faint/50";
          else cls += " text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]";
          if (ranged && !edge) cls += " bg-[color:var(--surface-strong)] text-fg";
          if (edge) cls += " bg-fg text-[color:var(--bg-deep)] hover:bg-fg";
          if (isToday && !edge) cls += " ring-1 ring-fg/40 ring-inset";
          if (isFocus && !edge) cls += " outline-none ring-1 ring-fg/60";
          return (
            <button
              key={day.toISOString()}
              type="button"
              tabIndex={isFocus ? 0 : -1}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className={cls}
            >
              {day.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
