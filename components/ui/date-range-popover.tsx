"use client";
import { useEffect, useRef, useState } from "react";
import { formatDate, parseDisplayDate } from "@/lib/format-date";
import { Calendar, CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";

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
  // Typed text mirrors of each endpoint. Kept in sync with the committed value
  // (grid clicks, presets, clear) via the effects below, mirroring DatePicker.
  const [textStart, setTextStart] = useState(formatDate(value.start));
  const [textTarget, setTextTarget] = useState(formatDate(value.target));
  const startInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync internal state when the popover opens.
  useEffect(() => {
    if (!open) return;
    setPicking("start");
    setHover(null);
    const seed = value.start ?? today;
    setAnchor(new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1)));
    setFocusDay(seed);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the typed fields in step with the committed value when it changes from
  // outside the inputs (grid click, preset, clear, parent update).
  useEffect(() => {
    setTextStart(formatDate(value.start));
  }, [value.start]);
  useEffect(() => {
    setTextTarget(formatDate(value.target));
  }, [value.target]);

  function commit(next: DateRange) {
    onChange(next);
  }

  // Typed entry, coherent with DatePicker: parse dd/mm/yyyy (slashes by hand),
  // commit only a complete, in-order date; otherwise keep the text uncommitted
  // and let aria-invalid flag it. Never store start > target — the edited field
  // that would invert the range is treated as not-yet-valid, like a below-min
  // date in DatePicker. No auto-swap on typing (that stays a grid-click thing).
  function onStartText(next: string) {
    setTextStart(next);
    if (next.trim() === "") {
      commit({ start: null, target: value.target });
      return;
    }
    const parsed = parseDisplayDate(next);
    if (!parsed) return;
    if (value.target && parsed.getTime() > value.target.getTime()) return;
    commit({ start: parsed, target: value.target });
    setAnchor(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)));
    setFocusDay(parsed);
    // A complete start date auto-advances to the target field, but only when
    // target is still empty — don't yank focus while editing a full range.
    if (!value.target) targetInputRef.current?.focus();
  }
  function onTargetText(next: string) {
    setTextTarget(next);
    if (next.trim() === "") {
      commit({ start: value.start, target: null });
      return;
    }
    const parsed = parseDisplayDate(next);
    if (!parsed) return;
    if (value.start && parsed.getTime() < value.start.getTime()) return;
    commit({ start: value.start, target: parsed });
    setAnchor(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)));
    setFocusDay(parsed);
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

  // Per-field validity, mirroring DatePicker: a non-empty field is invalid when
  // it doesn't parse, or when committing it would invert the range (start after
  // target, or target before start). Drives aria-invalid; uncommitted either way.
  const startParsed = parseDisplayDate(textStart);
  const startInvalid =
    Boolean(textStart.trim()) &&
    (!startParsed ||
      Boolean(value.target && startParsed.getTime() > value.target.getTime()));
  const targetParsed = parseDisplayDate(textTarget);
  const targetInvalid =
    Boolean(textTarget.trim()) &&
    (!targetParsed ||
      Boolean(value.start && targetParsed.getTime() < value.start.getTime()));
  // Duration readout ("6w") shown after the fields when the range is complete.
  const durationLabel =
    value.start && value.target ? fmtDuration(diffDays(value.start, value.target)) : null;

  const isEmpty = !value.start && !value.target;

  // Click-outside + Esc to close.  We render the popup inline (not in a
  // portal) so it nests cleanly inside whatever modal/dialog the trigger
  // lives in — base-ui's Popover Portal fights with Dialog focus trapping
  // and the trigger silently fails to open the popup on the first click.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <div
        role="group"
        aria-label={triggerLabel}
        data-testid="date-range-trigger"
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          startInputRef.current?.focus();
        }}
        className={
          "inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-hairline-hi bg-[color:var(--surface)] text-fg hover:bg-[color:var(--surface-strong)] transition-colors focus-within:ring-1 focus-within:ring-fg/40 cursor-text " +
          (disabled ? "opacity-50 pointer-events-none" : "")
        }
      >
        <CalendarRange className="size-3.5 text-fg-muted pointer-events-none" aria-hidden />
        <input
          type="text"
          inputMode="numeric"
          aria-label="Start date"
          aria-invalid={startInvalid || undefined}
          disabled={disabled}
          placeholder="dd/mm/yyyy"
          value={textStart}
          ref={startInputRef}
          data-testid="date-range-start"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onChange={(e) => onStartText(e.target.value)}
          className={
            "w-[5.25rem] bg-transparent font-mono text-[0.8rem] tabular-nums outline-none placeholder:text-fg-faint " +
            (!textStart.trim() ? "text-fg-faint" : "text-fg")
          }
        />
        <span className="text-fg-faint text-[0.8rem] pointer-events-none">—</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Target date"
          aria-invalid={targetInvalid || undefined}
          disabled={disabled}
          placeholder="dd/mm/yyyy"
          value={textTarget}
          ref={targetInputRef}
          data-testid="date-range-target"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onChange={(e) => onTargetText(e.target.value)}
          className={
            "w-[5.25rem] bg-transparent font-mono text-[0.8rem] tabular-nums outline-none placeholder:text-fg-faint " +
            (!textTarget.trim() ? "text-fg-faint" : "text-fg")
          }
        />
        {durationLabel ? (
          <span className="mono-meta-sm text-fg-faint pointer-events-none ml-0.5">
            · {durationLabel}
          </span>
        ) : null}
      </div>
      {open && (
        <div
          role="dialog"
          aria-label="Pick start and target dates"
          onKeyDown={onGridKey}
          className="absolute left-0 top-full mt-2 z-50 w-[640px] max-w-[calc(100vw-2rem)] rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-3 shadow-[0_40px_100px_-32px_rgba(0,0,0,0.6)] outline-none"
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
          <div ref={gridRef} className="grid grid-cols-2">
            {[anchor, new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1))].map(
              (m, mi) => (
                <div
                  key={mi}
                  className={
                    mi === 0
                      ? "pr-3 border-r border-hairline"
                      : "pl-3"
                  }
                >
                  <MonthGrid
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
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

// Single-day picker built on the same calendar grid as DateRangePopover.
// Used for `dueDate`-style fields where one date wins.
const SINGLE_PRESETS: { label: string; days: number }[] = [
  { label: "TODAY", days: 0 },
  { label: "+1W", days: 7 },
  { label: "+2W", days: 14 },
  { label: "+1M", days: 30 },
];

export function DatePopover({
  value,
  onChange,
  disabled,
  triggerLabel = "Set date",
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const today = startOfDayUTC(new Date());
  const [open, setOpen] = useState(false);
  const seedAnchor = startOfDayUTC(value ?? new Date());
  const [anchor, setAnchor] = useState<Date>(() =>
    new Date(Date.UTC(seedAnchor.getUTCFullYear(), seedAnchor.getUTCMonth(), 1)),
  );
  const [focusDay, setFocusDay] = useState<Date>(seedAnchor);

  useEffect(() => {
    if (!open) return;
    const seed = startOfDayUTC(value ?? new Date());
    setAnchor(new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1)));
    setFocusDay(seed);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickDay(d: Date) {
    onChange(d);
    setOpen(false);
  }
  function applyPreset(days: number) {
    pickDay(addDaysUTC(today, days));
  }
  function clear() {
    onChange(null);
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

  const cells = buildMonth(anchor);
  const cellsNext = buildMonth(addMonths(anchor, 1));

  const triggerText = value ? formatDate(value) : triggerLabel;
  const isEmpty = !value;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="date-popover-trigger"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-hairline-hi bg-[color:var(--surface)] text-fg hover:bg-[color:var(--surface-strong)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 font-mono text-[0.8rem] tabular-nums"
      >
        <Calendar className="size-3.5 text-fg-muted" aria-hidden />
        <span className={isEmpty ? "text-fg-faint" : undefined}>{triggerText}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick date"
          onKeyDown={onGridKey}
          className="absolute left-0 top-full mt-2 z-50 w-[640px] max-w-[calc(100vw-2rem)] rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-3 shadow-[0_40px_100px_-32px_rgba(0,0,0,0.6)] outline-none"
        >
          <div className="flex items-center gap-1.5 mb-3 px-1">
            {SINGLE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="chip mono-meta-sm px-2 py-1 hover:bg-[color:var(--surface-hi)] hover:text-fg"
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto mono-meta-sm text-fg-faint">PICK DATE</span>
            {!isEmpty && (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear date"
                className="size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2">
            {[anchor, addMonths(anchor, 1)].map((m, mi) => (
              <div
                key={mi}
                className={
                  mi === 0
                    ? "pr-3 border-r border-hairline"
                    : "pl-3"
                }
              >
                <MonthGrid
                  anchor={m}
                  cells={mi === 0 ? cells : cellsNext}
                  today={today}
                  focusDay={focusDay}
                  inRange={() => false}
                  isEdge={(d) => (value && isSameDay(d, value) ? "start" : null)}
                  onPick={pickDay}
                  onHover={() => {}}
                  onPrev={mi === 0 ? () => setAnchor(addMonths(anchor, -1)) : undefined}
                  onNext={mi === 1 ? () => setAnchor(addMonths(anchor, 1)) : undefined}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
          const ranged = inRange(day) && !edge;
          const isToday = isSameDay(day, today);
          const isFocus = isSameDay(day, focusDay);
          // Build classes with single-source resolution per concern so
          // Tailwind doesn't end up with two `text-*` rules competing
          // (the previous implementation left `text-fg-muted` and
          // `text-[color:var(--bg-deep)]` both attached, and the cascade
          // sometimes won the muted one — selected day went invisible).
          const palette = edge
            ? "bg-fg text-[#0a0a0a] hover:bg-fg"
            : ranged
              ? "bg-[color:var(--surface-strong)] text-fg hover:bg-[color:var(--surface-hi)]"
              : !inMonth
                ? "text-fg-faint/50 hover:bg-[color:var(--surface-strong)] hover:text-fg-muted"
                : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]";
          const ring = isToday && !edge
            ? " ring-1 ring-fg/40 ring-inset"
            : isFocus && !edge
              ? " outline-none ring-1 ring-fg/60"
              : "";
          const cls =
            "size-7 inline-flex items-center justify-center text-[0.78rem] font-mono tabular-nums transition-colors rounded-md " +
            palette +
            ring;
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
