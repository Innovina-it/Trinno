"use client";
import { useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";

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
    <div className="mb-1 flex flex-wrap gap-1" data-testid="label-stripes">
      {attached.map((l) => (
        <span
          key={l.id}
          data-label-id={l.id}
          className="inline-block h-2 w-10 rounded"
          style={{ backgroundColor: l.color }}
          title={l.name || l.color}
        />
      ))}
    </div>
  );
}
