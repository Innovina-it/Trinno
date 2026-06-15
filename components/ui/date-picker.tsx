"use client";

import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatDate, parseDisplayDate } from "@/lib/format-date";

const MS_DAY = 86_400_000;
const PRESETS: { label: string; days: number }[] = [
  { label: "TODAY", days: 0 },
  { label: "+1W", days: 7 },
  { label: "+2W", days: 14 },
  { label: "+1M", days: 30 },
];

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DAY);
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildMonth(anchor: Date): { day: Date; inMonth: boolean }[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = addDaysUTC(first, -lead);
  const cells: { day: Date; inMonth: boolean }[] = [];

  for (let i = 0; i < 42; i++) {
    const day = addDaysUTC(start, i);
    cells.push({ day, inMonth: day.getUTCMonth() === anchor.getUTCMonth() });
  }

  return cells;
}

export function DatePicker({
  value,
  onChange,
  disabled,
  triggerLabel = "Set date",
  inputLabel = "Date",
  align = "left",
  minDate,
  defaultToToday = false,
  open: controlledOpen,
  onOpenChange,
  blockOpen = false,
  onBlockedOpen,
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
  disabled?: boolean;
  triggerLabel?: string;
  inputLabel?: string;
  align?: "left" | "right";
  // Earliest selectable day (inclusive). Days before it are muted and
  // non-pickable across grid, keyboard, text entry, and presets. Absent =
  // any day allowed (the historical behavior — keeps non-task callers intact).
  minDate?: Date | null;
  // Opt-in: when the field is empty and the calendar opens, commit today
  // (clamped up to minDate) as the value. Off by default so shared callers
  // like the due-date picker never auto-stamp a date just by being opened.
  defaultToToday?: boolean;
  // Controlled open: when provided, the parent owns the open/closed state
  // (e.g. so a sibling picker can pop this one open). Absent = self-managed.
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  // Gate opening: when blockOpen is true, a trigger interaction calls
  // onBlockedOpen instead of opening the calendar — used to force a
  // prerequisite field (e.g. "set start before target") to be filled first.
  blockOpen?: boolean;
  onBlockedOpen?: () => void;
}) {
  const today = startOfDayUTC(new Date());
  const min = minDate ? startOfDayUTC(minDate) : null;
  const belowMin = (d: Date): boolean => Boolean(min && d.getTime() < min.getTime());
  const formattedValue = formatDate(value);
  // Seed the calendar's focus on a *selectable* day so keyboard-Enter never
  // lands on a disabled cell. The displayed value may legitimately predate
  // min (a legacy card with a past date), so clamp the focus seed up to min.
  const rawSeed = startOfDayUTC(value ?? new Date());
  const seed = min && rawSeed.getTime() < min.getTime() ? min : rawSeed;
  const [openState, setOpenState] = useState(false);
  const open = controlledOpen ?? openState;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setOpenState(next);
  };
  // Funnel every "open the calendar" entry point through here so blockOpen
  // can divert to onBlockedOpen instead (and disabled stays a hard stop).
  const tryOpen = () => {
    if (disabled) return;
    if (blockOpen) {
      onBlockedOpen?.();
      return;
    }
    setOpen(true);
  };
  const [text, setText] = useState(formattedValue);
  const [anchor, setAnchor] = useState(() =>
    new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1)),
  );
  const [focusDay, setFocusDay] = useState(seed);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(formattedValue);
  }, [formattedValue]);

  useEffect(() => {
    if (!open) return;
    // defaultToToday: an empty field commits today (clamped up to min, so a
    // target whose start is in the future defaults to the start, never below
    // it) the moment its calendar opens.
    if (defaultToToday && value == null) {
      const def = min && today.getTime() < min.getTime() ? min : today;
      onChange(def);
      setText(formatDate(def));
      setAnchor(new Date(Date.UTC(def.getUTCFullYear(), def.getUTCMonth(), 1)));
      setFocusDay(def);
      return;
    }
    const raw = startOfDayUTC(value ?? new Date());
    const nextSeed = min && raw.getTime() < min.getTime() ? min : raw;
    setAnchor(new Date(Date.UTC(nextSeed.getUTCFullYear(), nextSeed.getUTCMonth(), 1)));
    setFocusDay(nextSeed);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;

    function onDocClick(e: globalThis.MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }

    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // setOpen is a stable-enough closure recreated each render; re-binding the
    // listeners on it is unnecessary and only the open flag should re-run this.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickDay(day: Date) {
    if (belowMin(day)) return;
    onChange(day);
    setText(formatDate(day));
    setOpen(false);
  }

  function applyPreset(days: number) {
    pickDay(addDaysUTC(today, days));
  }

  function clear() {
    onChange(null);
    setText("");
  }

  function nudgeFocus(deltaDays: number) {
    const moved = addDaysUTC(focusDay, deltaDays);
    // Keyboard focus must stay on a selectable day — clamp up to min so
    // arrow-keys can't park the cursor on a disabled (pre-min) cell.
    const next = min && moved.getTime() < min.getTime() ? min : moved;
    setFocusDay(next);

    if (
      next.getUTCFullYear() !== anchor.getUTCFullYear() ||
      next.getUTCMonth() !== anchor.getUTCMonth()
    ) {
      setAnchor(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1)));
    }
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudgeFocus(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudgeFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nudgeFocus(-7);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudgeFocus(7);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickDay(focusDay);
    } else if (e.key.toLowerCase() === "t") {
      e.preventDefault();
      // "Today" shortcut — but never focus a disabled day; clamp to min.
      const jump = min && today.getTime() < min.getTime() ? min : today;
      setFocusDay(jump);
      setAnchor(new Date(Date.UTC(jump.getUTCFullYear(), jump.getUTCMonth(), 1)));
    }
  }

  function onDisplayKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tryOpen();
    }
  }

  function onTextChange(nextText: string) {
    // While gated (blockOpen), the field commits nothing — the prerequisite
    // field must be filled first. onBlockedOpen already fired on focus.
    if (blockOpen) {
      onBlockedOpen?.();
      return;
    }
    setText(nextText);

    if (nextText.trim() === "") {
      onChange(null);
      return;
    }

    const parsed = parseDisplayDate(nextText);
    // A parseable date before min is treated as not-yet-valid: we keep the
    // typed text (so the user can keep editing) but don't commit it. The
    // aria-invalid flag below reflects the same rule.
    if (parsed && !belowMin(parsed)) {
      onChange(parsed);
      setAnchor(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)));
      setFocusDay(parsed);
    }
  }

  const cells = buildMonth(anchor);
  const cellsNext = buildMonth(addMonths(anchor, 1));
  const isEmpty = !text.trim();
  const parsedText = parseDisplayDate(text);
  const invalid =
    Boolean(text.trim()) && (!parsedText || belowMin(parsedText));
  const inputClassName =
    "h-full w-32 bg-transparent pr-2.5 font-mono text-[0.8rem] tabular-nums outline-none placeholder:text-fg-faint " +
    (isEmpty ? "text-fg-faint" : "text-fg");

  return createElement(
    "div",
    { ref: wrapRef, className: "relative inline-block" },
    createElement(
      "div",
      {
        className:
          "inline-flex items-center gap-1.5 h-8 rounded-md border border-hairline-hi bg-[color:var(--surface)] text-fg hover:bg-[color:var(--surface-strong)] disabled:opacity-50 transition-colors focus-within:ring-1 focus-within:ring-fg/40 cursor-text",
        onClick: () => {
          if (disabled) return;
          if (blockOpen) {
            onBlockedOpen?.();
            return;
          }
          setOpen(true);
          inputRef.current?.focus();
        },
      },
      createElement(Calendar, {
        className: "ml-2.5 size-3.5 text-fg-muted pointer-events-none",
        "aria-hidden": true,
      }),
      createElement("input", {
        type: "text",
        inputMode: "numeric",
        "aria-label": inputLabel,
        "aria-invalid": invalid || undefined,
        disabled,
        placeholder: "dd/mm/yyyy",
        value: text,
        ref: inputRef,
        onClick: (e: MouseEvent<HTMLInputElement>) => {
          e.stopPropagation();
          tryOpen();
        },
        onFocus: () => tryOpen(),
        onKeyDown: onDisplayKeyDown,
        onChange: (e: ChangeEvent<HTMLInputElement>) => onTextChange(e.target.value),
        "data-testid": "date-picker-display",
        className: inputClassName,
      }),
    ),
    open
      ? createElement(
          "div",
          {
            role: "dialog",
            "aria-label": "Pick date",
            onKeyDown: onGridKey,
            className:
              "absolute " +
              (align === "right" ? "right-0" : "left-0") +
              " top-full mt-2 z-50 w-[640px] max-w-[calc(100vw-2rem)] rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-3 shadow-[0_40px_100px_-32px_rgba(0,0,0,0.6)] outline-none",
          },
          createElement(
            "div",
            { className: "flex items-center gap-1.5 mb-3 px-1" },
            PRESETS.map((preset) => {
              // A preset that resolves before min is dead — mute it and drop
              // the click so it can't smuggle a pre-min date past pickDay.
              const presetDisabled = belowMin(addDaysUTC(today, preset.days));
              return createElement(
                "button",
                {
                  key: preset.label,
                  type: "button",
                  disabled: presetDisabled,
                  onClick: presetDisabled
                    ? undefined
                    : () => applyPreset(preset.days),
                  className:
                    "chip mono-meta-sm px-2 py-1 " +
                    (presetDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-[color:var(--surface-hi)] hover:text-fg"),
                },
                preset.label,
              );
            }),
            createElement(
              "span",
              { className: "ml-auto mono-meta-sm text-fg-faint" },
              "PICK DATE",
            ),
            value
              ? createElement(
                  "button",
                  {
                    type: "button",
                    onClick: clear,
                    "aria-label": "Clear date",
                    className:
                      "size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center",
                  },
                  createElement(X, { className: "size-3.5" }),
                )
              : null,
          ),
          createElement(
            "div",
            { className: "grid grid-cols-2" },
            [anchor, addMonths(anchor, 1)].map((month, monthIndex) =>
              createElement(
                "div",
                {
                  key: monthIndex,
                  className:
                    monthIndex === 0
                      ? "pr-3 border-r border-hairline"
                      : "pl-3",
                },
                createElement(MonthGrid, {
                anchor: month,
                cells: monthIndex === 0 ? cells : cellsNext,
                today,
                focusDay,
                selected: value,
                minDate: min,
                onPick: pickDay,
                onPrev: monthIndex === 0 ? () => setAnchor(addMonths(anchor, -1)) : undefined,
                onNext: monthIndex === 1 ? () => setAnchor(addMonths(anchor, 1)) : undefined,
                }),
              ),
            ),
          ),
        )
      : null,
  );
}

function MonthGrid({
  anchor,
  cells,
  today,
  focusDay,
  selected,
  minDate,
  onPick,
  onPrev,
  onNext,
}: {
  anchor: Date;
  cells: { day: Date; inMonth: boolean }[];
  today: Date;
  focusDay: Date;
  selected: Date | null;
  minDate: Date | null;
  onPick: (day: Date) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { className: "flex items-center justify-between mb-2 px-1" },
      onPrev
        ? createElement(
            "button",
            {
              type: "button",
              onClick: onPrev,
              "aria-label": "Previous month",
              className:
                "size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center",
            },
            createElement(ChevronLeft, { className: "size-3.5" }),
          )
        : createElement("span", { className: "size-6" }),
      createElement(
        "span",
        { className: "mono-meta text-fg" },
        fmtMonth(anchor).toUpperCase(),
      ),
      onNext
        ? createElement(
            "button",
            {
              type: "button",
              onClick: onNext,
              "aria-label": "Next month",
              className:
                "size-6 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center",
            },
            createElement(ChevronRight, { className: "size-3.5" }),
          )
        : createElement("span", { className: "size-6" }),
    ),
    createElement(
      "div",
      { className: "grid grid-cols-7 gap-px text-center" },
      [
        ...["M", "T", "W", "T", "F", "S", "S"].map((dayLabel, index) =>
          createElement(
            "span",
            {
              key: `${dayLabel}-${index}`,
              className: "mono-meta-sm text-fg-faint py-1",
            },
            dayLabel,
          ),
        ),
        ...cells.map(({ day, inMonth }) => {
          const isSelected = Boolean(selected && isSameDay(day, selected));
          const isToday = isSameDay(day, today);
          const isFocus = isSameDay(day, focusDay);
          // Pre-min days are non-pickable: muted, no hover, not focusable.
          const isDisabled = Boolean(
            minDate && day.getTime() < minDate.getTime(),
          );
          const palette = isDisabled
            ? "text-fg-faint/30 cursor-not-allowed"
            : isSelected
              ? "bg-fg text-[#0a0a0a] hover:bg-fg"
              : !inMonth
                ? "text-fg-faint/50 hover:bg-[color:var(--surface-strong)] hover:text-fg-muted"
                : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]";
          const ring = isDisabled
            ? ""
            : isToday && !isSelected
              ? " ring-1 ring-fg/40 ring-inset"
              : isFocus && !isSelected
                ? " outline-none ring-1 ring-fg/60"
                : "";

          return createElement(
            "button",
            {
              key: day.toISOString(),
              type: "button",
              disabled: isDisabled,
              "aria-disabled": isDisabled || undefined,
              tabIndex: isFocus && !isDisabled ? 0 : -1,
              onClick: isDisabled ? undefined : () => onPick(day),
              className:
                "size-7 inline-flex items-center justify-center text-[0.78rem] font-mono tabular-nums transition-colors rounded-md " +
                palette +
                ring,
            },
            day.getUTCDate(),
          );
        }),
      ],
    ),
  );
}
