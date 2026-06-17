"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { DriveMode } from "./upload-step";

// Segmented control: Auto | Manual | Off. Selecting Manual expands the middle
// segment into the Drive-folder input while Auto/Off shrink to side tabs
// (per the approved sketch). The expand is a flex-basis transition; the label
// and input cross-fade. ease-out-quart, ~220ms.
const EASE = "cubic-bezier(0.16,1,0.3,1)";

export function DriveModeControl({
  mode,
  onMode,
  folderId,
  onFolderId,
  disabled,
}: {
  mode: DriveMode;
  onMode: (m: DriveMode) => void;
  folderId: string;
  onFolderId: (v: string) => void;
  disabled?: boolean;
}) {
  const manual = mode === "manual";
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the folder input the moment Manual is selected, so the user can type
  // immediately instead of clicking the field.
  useEffect(() => {
    if (manual) inputRef.current?.focus();
  }, [manual]);

  const tab = (active: boolean) =>
    cn(
      "flex min-w-0 items-center justify-center px-3 text-sm outline-none transition-colors duration-200",
      "focus-visible:ring-1 focus-visible:ring-fg/40",
      active
        ? "bg-fg font-medium text-[color:var(--bg-deep)]"
        : "text-fg-muted hover:text-fg",
    );
  // Auto/Off: full third when not manual; shrink to a side tab when manual.
  const sideStyle = {
    flexGrow: manual ? 0 : 1,
    flexBasis: manual ? "4.25rem" : 0,
    transition: `flex-grow 220ms ${EASE}, flex-basis 220ms ${EASE}`,
  };

  return (
    <div
      role="radiogroup"
      aria-label="Deliverable docs mode"
      className={cn(
        "flex h-10 items-stretch overflow-hidden rounded-full border border-[color:var(--hairline)] bg-[color:var(--surface)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "auto"}
        onClick={() => onMode("auto")}
        style={sideStyle}
        className={tab(mode === "auto")}
      >
        Auto
      </button>

      <span className="h-5 w-px self-center bg-[color:var(--hairline)]" aria-hidden />

      <div
        className="relative flex min-w-0 items-center"
        style={{ flexGrow: 1, flexBasis: 0 }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "manual"}
          onClick={() => onMode("manual")}
          className={cn(
            "absolute inset-0 flex items-center justify-center text-sm transition-opacity duration-150",
            "text-fg-muted hover:text-fg focus-visible:ring-1 focus-visible:ring-fg/40",
            manual ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          Manual
        </button>
        <input
          ref={inputRef}
          type="text"
          aria-label="Drive folder ID or link"
          value={folderId}
          tabIndex={manual ? 0 : -1}
          placeholder="Drive folder ID or link"
          onChange={(e) => onFolderId(e.target.value)}
          className={cn(
            "h-full w-full bg-transparent px-3.5 text-sm text-fg outline-none transition-opacity duration-150",
            "placeholder:font-serif placeholder:italic placeholder:text-fg-faint",
            manual ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />
      </div>

      <span className="h-5 w-px self-center bg-[color:var(--hairline)]" aria-hidden />

      <button
        type="button"
        role="radio"
        aria-checked={mode === "off"}
        onClick={() => onMode("off")}
        style={sideStyle}
        className={tab(mode === "off")}
      >
        Off
      </button>
    </div>
  );
}
