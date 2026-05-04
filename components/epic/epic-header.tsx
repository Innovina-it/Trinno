"use client";
import Link from "next/link";
import { CalendarRange, Map as MapIcon } from "lucide-react";
import { cardCode } from "@/lib/format";
import type { CardRow } from "@/lib/queries/board-snapshot";

function fmtShortDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

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
    <header className="space-y-4 border-b border-hairline pb-6">
      <div className="flex items-baseline gap-3">
        <span className="chip mono-meta-sm">EPIC</span>
        <span className="mono-meta-sm text-fg-faint">#{cardCode(epic.id)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <h1 className="text-3xl font-semibold leading-tight truncate">
            {epic.title}
          </h1>
          <div className="flex items-center gap-3 mono-meta-sm text-fg-muted">
            {(epic.startDate || epic.targetDate) && (
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="size-3" />
                {epic.startDate ? fmtShortDate(epic.startDate) : "?"}
                {" → "}
                {epic.targetDate ? fmtShortDate(epic.targetDate) : "?"}
              </span>
            )}
            <span>
              {doneCount}/{childCount} done · {pct}%
            </span>
          </div>
        </div>
        <Link
          href={`/w/${workspaceId}/roadmap?focus=${epic.id}`}
          className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)]"
        >
          <MapIcon className="size-3" />
          View on roadmap
        </Link>
      </div>
      {childCount > 0 && (
        <div className="h-1 rounded-full bg-[color:var(--surface)] overflow-hidden">
          <div
            className="h-full bg-[color:var(--status-done)]"
            style={{ width: `${pct}%` }}
            aria-label={`${pct}% complete`}
          />
        </div>
      )}
    </header>
  );
}
