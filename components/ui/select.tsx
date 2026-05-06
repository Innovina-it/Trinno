"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Studio-Console <select> replacement.  Native <select> dropdown panels
// are OS-painted in Firefox + Safari (and inconsistent in Chromium on
// Linux), which violates the Solid Popover Rule.  This component renders
// a controlled inline overlay instead (no portal so it nests cleanly
// inside Dialogs), with the same `--popover` background and hairline-hi
// border the rest of the floating chrome uses.

export type SelectOption =
  | { value: string; label: string; disabled?: boolean }
  | { type: "separator"; key?: string };

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  className,
  disabled,
  size = "default",
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "default" | "sm";
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

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

  // Focus the active item when opening for keyboard nav.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLButtonElement>(
      'button[data-active="true"]',
    );
    (active ?? listRef.current.querySelector("button"))?.focus();
  }, [open]);

  const items = options.filter(
    (o): o is Extract<SelectOption, { value: string }> => "value" in o,
  );
  const current = items.find((o) => o.value === value);
  const triggerLabel = current?.label ?? placeholder;
  const isEmpty = !current;

  function pick(v: string) {
    onValueChange(v);
    setOpen(false);
  }

  function onListKey(e: React.KeyboardEvent) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ) ?? [],
    );
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  const heightCls = size === "sm" ? "h-8" : "h-9";

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        className={cn(
          "inline-flex items-center justify-between gap-2 px-2.5 rounded-md border border-hairline-hi bg-[color:var(--surface)] text-fg hover:bg-[color:var(--surface-strong)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 text-sm tabular-nums w-full",
          heightCls,
        )}
      >
        <span className={cn("truncate text-left", isEmpty && "text-fg-faint")}>
          {triggerLabel}
        </span>
        <ChevronDown className="size-3.5 text-fg-muted shrink-0" aria-hidden />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onListKey}
          className="absolute left-0 top-full mt-1 z-50 min-w-full max-w-[min(100vw-2rem,24rem)] max-h-72 overflow-y-auto rounded-xl border border-hairline-hi bg-[color:var(--popover)] p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.7)] outline-none"
        >
          {options.map((o, i) => {
            if ("type" in o) {
              return (
                <li
                  key={o.key ?? `sep-${i}`}
                  role="separator"
                  className="my-1 h-px bg-hairline"
                />
              );
            }
            const active = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={o.disabled}
                  data-active={active ? "true" : undefined}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none disabled:opacity-50",
                    active
                      ? "bg-[color:var(--surface-hi)] text-fg"
                      : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus:bg-[color:var(--surface-strong)] focus:text-fg",
                  )}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {active && <Check className="size-3.5 shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
