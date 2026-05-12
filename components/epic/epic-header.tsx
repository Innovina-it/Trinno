"use client";
import Link from "next/link";
import { CalendarRange, Map as MapIcon } from "lucide-react";
import { cardCode } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { CardRow } from "@/lib/queries/board-snapshot";

export function EpicHeader({
  epic, workspaceId, childCount, doneCount,
}: {
  epic: CardRow;
  workspaceId: string;
  childCount: number;
  doneCount: number;
}) {
  const pct = childCount === 0 ? 0 : Math.round((doneCount / childCount) * 100);
  return (
    <header className="space-y-3 border-b border-hairline pb-4">
      {/* Breadcrumb back to the workspace + roadmap. */}
      <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
        <Link
          href={`/w/${workspaceId}`}
          className="hover:text-fg"
        >
          WORKSPACE
        </Link>
        <span>/</span>
        <Link
          href={`/w/${workspaceId}/roadmap`}
          className="hover:text-fg"
        >
          ROADMAP
        </Link>
        <span>/</span>
        <span className="text-fg">EPIC #{cardCode(epic.id)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <h1 className="font-sans text-2xl font-bold tracking-tight text-fg leading-tight truncate">
            {epic.title}
          </h1>
          <div className="flex items-center gap-3 mono-meta-sm text-fg-muted tabular-nums">
            {(epic.startDate || epic.targetDate) && (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="size-3" aria-hidden />
                {epic.startDate ? formatDate(epic.startDate) : "?"}
                {" → "}
                {epic.targetDate ? formatDate(epic.targetDate) : "?"}
              </span>
            )}
            <span>
              {doneCount}/{childCount} DONE · {pct}%
            </span>
          </div>
        </div>
        <Link
          href={`/w/${workspaceId}/roadmap?focus=${epic.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
        >
          <MapIcon className="size-3.5" aria-hidden />
          Open on roadmap
        </Link>
      </div>
      {childCount > 0 && (
        <div
          className="h-1 rounded-full bg-[color:var(--surface)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% complete`}
        >
          <div
            className="h-full bg-[color:var(--status-done)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </header>
  );
}
