"use client";
import { useMemo } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { dayDiff, pixelsPerDay, startOfDay, type Zoom } from "@/lib/roadmap/dates";

// Sprint axis: a 4px stripe sitting flush under the header date ticks.
// `planned` sprints render at fg/25, `active` at fg/60. Completed sprints
// are hidden. Labels appear inline when the band is wider than 56px so
// short bands stay clean. The full-canvas vertical bands were retired:
// they competed with bars for visual weight and broke the *Information
// First* rule.

export function SprintOverlay({
  zoom,
  gridStart,
  gridEnd,
  headerHeight,
}: {
  zoom: Zoom;
  gridStart: Date;
  gridEnd: Date;
  headerHeight: number;
}) {
  const allSprints = useWorkspaceStore((s) => s.sprints);
  const sprints = useMemo(
    () => allSprints.filter((sp) => sp.state !== "completed"),
    [allSprints],
  );
  const ppd = pixelsPerDay(zoom);
  const totalDays = Math.max(0, dayDiff(gridStart, gridEnd));

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none"
      aria-hidden
      data-testid="sprint-overlay"
      style={{ top: headerHeight - 4, height: 4 }}
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
        return (
          <div
            key={sp.id}
            data-testid="sprint-overlay-band"
            data-sprint-id={sp.id}
            data-sprint-state={sp.state}
            title={`${sp.name}${isActive ? " (active)" : ""}`}
            className={`absolute top-0 h-full rounded-sm ${
              isActive ? "bg-fg/60" : "bg-fg/25"
            }`}
            style={{ left: x, width: w }}
          >
            {/* Label threshold raised from 56 → 90: below 90px a truncated
                "SPRINT 1…" is noise. The hover title on the band still
                surfaces the full name. */}
            {w >= 90 && (
              <span
                // inline-block + explicit width is what text-overflow:ellipsis
                // actually needs to clip; maxWidth alone leaves the span free
                // to shrink-wrap past it on some browsers. The 8px gap keeps
                // adjacent bands' labels from visually colliding.
                className="absolute inline-block mono-meta-sm whitespace-nowrap text-fg-faint overflow-hidden text-ellipsis"
                style={{
                  top: -14,
                  left: 4,
                  width: Math.max(0, w - 8),
                }}
              >
                {sp.name.toUpperCase()}
                {isActive ? " · ACTIVE" : ""}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
