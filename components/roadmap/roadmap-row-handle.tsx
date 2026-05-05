"use client";
import { useCallback } from "react";
import { GripVertical } from "lucide-react";

// Plan #16b-γ-G G1 — drag handle button for manual roadmap row reorder.
// Renders a small ≡ icon at the LEFT edge of a row (sticky-left inside
// the scrollable canvas so it stays visible during horizontal scroll).
// Visible on hover only; pointerdown triggers row-drag and stops the
// event propagating so the bar's pointermove drag never fires.

export function RoadmapRowHandle({
  cardId,
  onDragStart,
}: {
  cardId: string;
  onDragStart: (cardId: string, e: React.PointerEvent) => void;
}) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Stop the canvas-level click handler and the bar's drag from
      // firing. We intentionally do NOT preventDefault here — the parent
      // handler captures pointermove/pointerup on window itself.
      e.stopPropagation();
      e.preventDefault();
      onDragStart(cardId, e);
    },
    [cardId, onDragStart],
  );

  return (
    <button
      type="button"
      data-testid="roadmap-row-handle"
      data-card-id={cardId}
      aria-label="Reorder row"
      onPointerDown={handlePointerDown}
      // Stop click bubbling so the canvas empty-area click doesn't open
      // the new-card dialog when releasing a no-op drag on the handle.
      onClick={(e) => e.stopPropagation()}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity absolute left-1 top-1.5 z-10 size-5 rounded-md border border-hairline bg-[color:var(--surface-strong)] text-fg-muted hover:text-fg flex items-center justify-center cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="size-3" />
    </button>
  );
}
