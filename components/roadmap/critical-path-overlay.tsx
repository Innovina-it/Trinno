"use client";
import type { BarBox } from "./dependency-arrows";
import type { RoadmapLink } from "@/lib/queries/roadmap";

// Highlights every bar on a longest-path with a 2px outline + right-edge
// dot, AND draws thicker connector curves between consecutive critical
// bars so the path reads as a single chain at a glance. The connectors
// use the same cubic-bezier shape DependencyArrows draws but at higher
// opacity and weight so the chain visually beats out the surrounding
// dependency graph.

const BAR_HEIGHT = 28;
const HALF_BAR = BAR_HEIGHT / 2;

export function CriticalPathOverlay({
  critical,
  links,
  barCoords,
  width,
  height,
}: {
  critical: Set<string>;
  links: RoadmapLink[];
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

  const bars: { id: string; box: BarBox }[] = [];
  for (const id of critical) {
    const box = barCoords.get(id);
    if (box) bars.push({ id, box });
  }

  // Connector edges: a `is_blocked_by` link is critical only when both
  // endpoints lie on the longest path AND both bars are visible.
  const connectors = links.filter(
    (l) =>
      critical.has(l.fromId) &&
      critical.has(l.toId) &&
      barCoords.has(l.fromId) &&
      barCoords.has(l.toId),
  );

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 text-fg"
      width={width}
      height={height}
      aria-hidden
      data-testid="roadmap-critical-overlay"
    >
      <defs>
        <marker
          id="roadmap-critical-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" opacity="0.95" />
        </marker>
      </defs>

      {/* Connector chain — drawn first so the bar outlines paint on top. */}
      {connectors.map((l, i) => {
        const blocker = barCoords.get(l.toId)!;
        const blocked = barCoords.get(l.fromId)!;
        const sx = blocker.x + blocker.w;
        const sy = blocker.y;
        const ex = blocked.x;
        const ey = blocked.y;
        const dx = Math.max(20, Math.abs(ex - sx) / 2);
        const path = `M ${sx},${sy} C ${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`;
        return (
          <path
            key={`crit-link-${l.fromId}-${l.toId}-${i}`}
            data-testid="roadmap-critical-connector"
            d={path}
            stroke="currentColor"
            strokeOpacity="0.95"
            strokeWidth="2"
            fill="none"
            markerEnd="url(#roadmap-critical-arrowhead)"
          />
        );
      })}

      {/* Bar outlines + right-edge anchor dots. */}
      {bars.map(({ id, box }) => {
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
              strokeOpacity="0.8"
              strokeWidth="2"
            />
            <circle
              cx={box.x + Math.max(box.w, 12)}
              cy={top + HALF_BAR}
              r={3}
              fill="currentColor"
              fillOpacity="0.9"
            />
          </g>
        );
      })}
    </svg>
  );
}
