"use client";
import type { BarBox } from "./dependency-arrows";

// Plan #16b-γ-A (#3) — overlay layer that draws an outline on every
// roadmap bar that lies on a longest path. The bar geometry is provided
// by the parent (`barCoords` matches the same map dependency-arrows
// uses) so we don't re-do layout. Pure SVG — pointer events disabled so
// drag interactions still hit the underlying bars.
//
// Each critical bar gets a 2-px outline rectangle and a small dot at
// its right edge (a visual anchor for "this is on the longest path").

const BAR_HEIGHT = 28;
const HALF_BAR = BAR_HEIGHT / 2;

export function CriticalPathOverlay({
  critical,
  barCoords,
  width,
  height,
}: {
  critical: Set<string>;
  barCoords: Map<string, BarBox>;
  width: number;
  height: number;
}) {
  if (critical.size === 0) {
    return (
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={width}
        height={height}
        aria-hidden
      />
    );
  }
  const items: { id: string; box: BarBox }[] = [];
  for (const id of critical) {
    const box = barCoords.get(id);
    if (box) items.push({ id, box });
  }
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 text-fg"
      width={width}
      height={height}
      aria-hidden
      data-testid="roadmap-critical-overlay"
    >
      {items.map(({ id, box }) => {
        // box.y is the vertical center of the bar (matches dependency-
        // arrows). Map back to the top-left corner.
        const top = box.y - HALF_BAR;
        return (
          <g key={`crit-${id}`} data-card-id={id}>
            <rect
              x={box.x - 1}
              y={top - 1}
              width={Math.max(box.w, 12) + 2}
              height={BAR_HEIGHT + 2}
              rx={6}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.75"
              strokeWidth="2"
            />
            <circle
              cx={box.x + Math.max(box.w, 12)}
              cy={top + HALF_BAR}
              r={3}
              fill="currentColor"
              fillOpacity="0.85"
            />
          </g>
        );
      })}
    </svg>
  );
}
