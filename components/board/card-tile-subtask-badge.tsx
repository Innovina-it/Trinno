"use client";
import { Check } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { useBoardStore } from "@/stores/board-store";

// Standalone subtask progress badge for use in card tiles.
// Renders completed/total count. On hover shows a tooltip with up to 5
// subtask titles and "+ N more" if there are more.
export function SubtaskBadge({ cardId }: { cardId: string }) {
  const subtaskTotal = useBoardStore((s) => {
    let n = 0;
    for (const c of s.cards) {
      if (c.parentCardId === cardId && !c.archived) n += 1;
    }
    return n;
  });
  const subtaskDone = useBoardStore((s) => {
    let n = 0;
    for (const c of s.cards) {
      if (c.parentCardId === cardId && !c.archived && c.completedAt != null) n += 1;
    }
    return n;
  });
  const subtaskTitles = useBoardStore(
    useShallow((s) =>
      s.cards
        .filter((c) => c.parentCardId === cardId && !c.archived)
        .slice(0, 6)
        .map((c) => c.title),
    ),
  );

  if (subtaskTotal === 0) return null;

  const allDone = subtaskDone === subtaskTotal;
  const preview = subtaskTitles.slice(0, 5);
  const overflow = subtaskTotal - preview.length;

  return (
    <span
      data-testid="tile-subtasks"
      className="relative group/subtask-badge"
    >
      <span
        className={`chip mono-meta-sm inline-flex items-center gap-1 tabular-nums ${
          allDone ? "text-[color:var(--accent-lime)]" : "text-fg-muted"
        }`}
      >
        {subtaskDone}/{subtaskTotal}
        <Check className="size-3" aria-hidden />
      </span>

      {/* Hover tooltip with subtask titles */}
      <span
        role="tooltip"
        className={`
          pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          min-w-[10rem] max-w-[16rem] rounded-lg border border-hairline
          bg-[color:var(--surface)] px-2.5 py-2 shadow-lg z-50
          opacity-0 scale-95 transition-all duration-150
          group-hover/subtask-badge:opacity-100 group-hover/subtask-badge:scale-100
        `}
      >
        <ul className="space-y-1">
          {preview.map((title, i) => (
            <li key={i} className="mono-meta-sm text-fg-muted truncate">
              {title}
            </li>
          ))}
          {overflow > 0 && (
            <li className="mono-meta-sm text-fg-faint">+ {overflow} more</li>
          )}
        </ul>
      </span>
    </span>
  );
}
