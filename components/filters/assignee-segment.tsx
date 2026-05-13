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

// `title` carries scope context — every consumer of this component is
// workspace-scoped (board, roadmap, etc.); /me is the cross-workspace
// counterpart. Boss feedback 2026-05-13: copy must make that obvious.
const SEGMENTS: { value: AssigneeMode; label: string; title: string }[] = [
  {
    value: "all",
    label: "All",
    title: "Every card in this workspace, regardless of assignee.",
  },
  {
    value: "me",
    label: "Mine",
    title: "Assigned to me in this workspace. /me shows all workspaces.",
  },
  {
    value: "none",
    label: "Unassigned",
    title: "Cards in this workspace with no owner and no assignees.",
  },
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
          title={seg.title}
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
