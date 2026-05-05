"use client";
import { forwardRef } from "react";
import { Flag } from "lucide-react";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

// Plan #16b-γ-G G4 — sticky-left gutter strip with 5 priority bands (P0-P4).
// Drop-target during a bar drag: cursor-Y over a band sets that priority on
// release. Renders as its own column to the LEFT of the lane-label panel —
// no overlay, no z-stacking conflicts.

export const PRIORITIES: CardPriority[] = ["p0", "p1", "p2", "p3", "p4"];
const SHORT_LABEL: Record<CardPriority, string> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
  p4: "P4",
};

export const PriorityGutter = forwardRef<
  HTMLDivElement,
  { height: number; hoveredBand: CardPriority | null }
>(function PriorityGutter({ height, hoveredBand }, ref) {
  return (
    <div
      ref={ref}
      data-testid="roadmap-priority-gutter"
      aria-hidden
      className="shrink-0 w-16 flex flex-col border-r border-hairline bg-[color:var(--bg-1)]"
      style={{ height }}
    >
      {PRIORITIES.map((p) => {
        const tint = PRIORITY_TINT[p];
        const isHovered = hoveredBand === p;
        return (
          <div
            key={p}
            data-testid="roadmap-priority-band"
            data-priority={p}
            className={`relative flex-1 flex items-center justify-center gap-1 mono-meta-sm transition-colors border-b border-hairline last:border-b-0 ${
              isHovered
                ? "bg-[color:var(--surface-strong)] text-fg ring-1 ring-fg/40 ring-inset"
                : "text-fg-muted"
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-0 top-0 bottom-0 w-1 ${tint.dot}`}
            />
            <Flag className="size-3" />
            <span>{SHORT_LABEL[p]}</span>
          </div>
        );
      })}
    </div>
  );
});
