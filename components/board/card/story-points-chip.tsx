"use client";
import { useBoardStore } from "@/stores/board-store";

export function StoryPointsChip({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) => s.cards.find((c) => c.id === cardId));
  const sp = (card as { storyPoints?: number | null } | undefined)?.storyPoints;
  if (sp === undefined || sp === null) return null;
  return (
    <span
      className="chip tabular-nums"
      data-testid="tile-story-points"
      title={`${sp} story point${sp === 1 ? "" : "s"}`}
    >
      {sp}
    </span>
  );
}
