"use client";
import { useMemo } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { dayDiff, pixelsPerDay, startOfDay, type Zoom } from "@/lib/roadmap/dates";

// Plan #16b-β — translucent vertical bands behind the bar layer that mark
// `planned` and `active` sprints on the timeline. Completed sprints are
// hidden so the forward-planning view stays uncluttered.

export function SprintOverlay({
  zoom,
  gridStart,
  gridEnd,
  height,
}: {
  zoom: Zoom;
  gridStart: Date;
  gridEnd: Date;
  height: number;
}) {
  // Select the unfiltered slice — zustand's `useStore` re-renders on
  // identity change. Filtering inside the selector creates a fresh array
  // every render and triggers React's "getSnapshot must be cached"
  // infinite-loop guard. Memoize the projection downstream instead.
  const allSprints = useWorkspaceStore((s) => s.sprints);
  const sprints = useMemo(
    () => allSprints.filter((sp) => sp.state !== "completed"),
    [allSprints],
  );
  const ppd = pixelsPerDay(zoom);
  const totalDays = Math.max(0, dayDiff(gridStart, gridEnd));

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      data-testid="sprint-overlay"
    >
      {sprints.map((sp) => {
        if (!sp.startDate || !sp.endDate) return null;
        const sStart = startOfDay(sp.startDate);
        const sEnd = startOfDay(sp.endDate);
        const startDays = Math.max(0, dayDiff(gridStart, sStart));
        const endDays = Math.min(totalDays, dayDiff(gridStart, sEnd));
        const x = startDays * ppd;
        const w = Math.max(0, (endDays - startDays) * ppd);
        if (w <= 0) return null;
        const isActive = sp.state === "active";
        const tone = isActive
          ? "rgb(255 255 255 / 0.06)"
          : "rgb(255 255 255 / 0.03)";
        return (
          <div
            key={sp.id}
            className="absolute top-0"
            data-testid="sprint-overlay-band"
            data-sprint-id={sp.id}
            data-sprint-state={sp.state}
            style={{
              left: x,
              width: w,
              height,
              background: tone,
              borderLeft: "1px dashed rgb(255 255 255 / 0.18)",
              borderRight: "1px dashed rgb(255 255 255 / 0.18)",
            }}
          >
            <span className="absolute top-1 left-2 mono-meta-sm text-fg-faint">
              {sp.name.toUpperCase()}
              {isActive ? " · ACTIVE" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
