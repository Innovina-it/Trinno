"use client";
import { Ban } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";

export function BlockedBadge({ cardId }: { cardId: string }) {
  const cardLinks = useBoardStore((s) => s.cardLinks);
  const count = cardLinks.filter(
    (l) => l.fromCardId === cardId && l.kind === "is_blocked_by",
  ).length;
  if (count === 0) return null;
  return (
    <span
      className="chip inline-flex items-center gap-1 text-fg/80"
      title={`Blocked by ${count} card${count === 1 ? "" : "s"}`}
      data-testid="tile-blocked"
    >
      <Ban className="size-3" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
