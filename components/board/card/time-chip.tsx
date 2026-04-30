"use client";
import { useBoardStore } from "@/stores/board-store";
import { Hourglass } from "lucide-react";

export function TimeChip({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) => s.cards.find((c) => c.id === cardId)) as
    | { estimateMin?: number | null; spentMin?: number | null }
    | undefined;
  const est = card?.estimateMin ?? null;
  const spent = card?.spentMin ?? 0;
  if (est == null && spent === 0) return null;
  const over = est != null && spent > est;
  return (
    <span
      className={`chip inline-flex items-center gap-1 tabular-nums ${over ? "text-fg" : "text-fg-muted"}`}
      title={`Logged ${spent}m${est != null ? ` of ${est}m estimated` : ""}`}
      data-testid="tile-time"
    >
      <Hourglass className="size-3" />
      {spent}/{est ?? "—"}m
    </span>
  );
}
