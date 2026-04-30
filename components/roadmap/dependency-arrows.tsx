"use client";
import type { RoadmapLink } from "@/lib/queries/roadmap";

export type BarBox = { x: number; y: number; w: number };

/**
 * SVG overlay for dependency arrows. Each link {fromId, toId} represents
 * "fromId is_blocked_by toId" — the arrow is drawn from the BLOCKER (toId)
 * toward the BLOCKED (fromId).
 *
 * Arrows are skipped when either endpoint isn't on the roadmap (filtered
 * by the caller, but we double-check here so a stale ref is harmless).
 */
export function DependencyArrows({
  links,
  barCoords,
  width,
  height,
}: {
  links: RoadmapLink[];
  barCoords: Map<string, BarBox>;
  width: number;
  height: number;
}) {
  const visibleLinks = links.filter(
    (l) => barCoords.has(l.fromId) && barCoords.has(l.toId),
  );
  if (visibleLinks.length === 0) {
    return (
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={width}
        height={height}
        aria-hidden
      />
    );
  }
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
      aria-hidden
      data-testid="roadmap-arrows"
    >
      <defs>
        <marker
          id="roadmap-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" opacity="0.6" />
        </marker>
      </defs>
      {visibleLinks.map((l, i) => {
        // l.fromId = blocked card, l.toId = blocker card.
        const blocker = barCoords.get(l.toId)!;
        const blocked = barCoords.get(l.fromId)!;
        const sx = blocker.x + blocker.w; // right edge of blocker
        const sy = blocker.y;
        const ex = blocked.x; // left edge of blocked
        const ey = blocked.y;
        const dx = Math.max(20, Math.abs(ex - sx) / 2);
        const path = `M ${sx},${sy} C ${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`;
        return (
          <path
            key={`${l.fromId}-${l.toId}-${i}`}
            d={path}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1.25"
            fill="none"
            markerEnd="url(#roadmap-arrowhead)"
            className="text-fg"
          />
        );
      })}
    </svg>
  );
}
