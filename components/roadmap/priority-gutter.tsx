"use client";
import { forwardRef } from "react";
import { Flag } from "lucide-react";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

// Plan #16b-γ-G G4 — sticky-left gutter strip with 5 colored bands (P0-P4).
// When the user drags a roadmap bar leftward into this region, the bar
// snaps to whichever band the cursor Y is over and on pointerup writes
// `cards.priority = band.value`.

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
      className="absolute left-0 top-0 w-16 z-10 flex flex-col pointer-events-none"
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
            className={`flex-1 flex items-center justify-center mono-meta-sm text-fg-muted border-r border-hairline transition-colors ${tint.chip} ${
              isHovered ? "ring-2 ring-fg/60 ring-inset" : ""
            }`}
          >
            <Flag className="size-3 mr-1" />
            {SHORT_LABEL[p]}
          </div>
        );
      })}
    </div>
  );
});
