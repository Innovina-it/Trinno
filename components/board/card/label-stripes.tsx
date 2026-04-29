"use client";
import { useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";

// Editorial-industrial label rendering: full-width horizontal stripes at the
// top edge of the card tile (like ledger tabs), no rounded corners. Stripes
// stack flush against each other to read as a single colour-coded margin.
export function LabelStripes({ cardId }: { cardId: string }) {
  const cardLabels = useBoardStore((s) => s.cardLabels);
  const labels = useBoardStore((s) => s.labels);
  const attached = useMemo(() => {
    const ids = new Set(
      cardLabels.filter((cl) => cl.cardId === cardId).map((cl) => cl.labelId),
    );
    return labels.filter((l) => ids.has(l.id));
  }, [cardLabels, labels, cardId]);

  if (attached.length === 0) return null;
  return (
    <div className="flex w-full" data-testid="label-stripes">
      {attached.map((l) => (
        <span
          key={l.id}
          data-label-id={l.id}
          className="block h-1.5 flex-1"
          style={{ backgroundColor: l.color }}
          title={l.name || l.color}
        />
      ))}
    </div>
  );
}
