"use client";
/**
 * Three-option segmented control for the assignee filter.
 * Shared across Board, Roadmap, All Tasks, and the cross-workspace timeline.
 *
 * URL param contract:
 *   assignee=me    → "Mine"
 *   assignee=none  → "Unassigned"
 *   (absent)       → "All"
 */
import type { AssigneeMode } from "@/lib/board-filters";

const SEGMENTS: { value: AssigneeMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "me", label: "Mine" },
  { value: "none", label: "Unassigned" },
];

export function AssigneeSegment({
  value,
  onChange,
}: {
  value: AssigneeMode;
  onChange: (next: AssigneeMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Assignee filter"
      data-testid="assignee-segment"
      className="inline-flex items-center rounded-full border border-hairline bg-[color:var(--surface)] overflow-hidden"
    >
      {SEGMENTS.map((seg, i) => (
        <button
          key={seg.value}
          type="button"
          role="radio"
          aria-checked={value === seg.value}
          data-testid={`assignee-segment-${seg.value}`}
          onClick={() => onChange(seg.value)}
          className={[
            "px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
            i > 0 ? "border-l border-hairline" : "",
            value === seg.value
              ? "bg-fg/10 text-fg font-medium"
              : "text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]",
          ].join(" ")}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}
