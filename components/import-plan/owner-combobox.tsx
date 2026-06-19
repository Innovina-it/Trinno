"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Creatable owner picker: type to add a new owner, or pick from the ones already
// used across the plan; "None" clears it. Styled with the app's popover tokens
// so the list matches the monochrome theme. mousedown-preventDefault on the
// options keeps the input focused so a click registers before blur closes it.
export function OwnerCombobox({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  // Only filter once the user types since focusing — a freshly focused field
  // that already holds an owner should reveal the full list, not just the names
  // matching the current value. Reset on focus, set on type.
  const [dirty, setDirty] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = dirty
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className="relative w-40 shrink-0">
      <Input
        aria-label={ariaLabel}
        placeholder="Owner"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setDirty(true);
        }}
        onFocus={() => {
          setOpen(true);
          setDirty(false);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") setOpen(false);
        }}
      />
      {open && !disabled && (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-[color:var(--hairline-hi)] bg-[color:var(--popover)] p-1 shadow-xl"
          role="listbox"
        >
          <li>
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm italic text-fg-faint hover:bg-[color:var(--surface-hi)] hover:text-fg"
              onMouseDown={(e) => {
                e.preventDefault();
                choose("");
              }}
            >
              None
            </button>
          </li>
          {matches.map((o) => (
            <li key={o}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-[color:var(--surface-hi)] hover:text-fg",
                  o === value ? "text-fg" : "text-fg-muted",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
