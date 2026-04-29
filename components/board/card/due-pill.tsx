"use client";
import type { CardRow } from "@/lib/queries/board-snapshot";

function formatDue(d: Date) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

export function DuePill({ card }: { card: CardRow }) {
  if (!card.dueDate) return null;
  const due = card.dueDate instanceof Date ? card.dueDate : new Date(card.dueDate);
  const overdue = !card.dueComplete && due.getTime() < Date.now();
  const cls = card.dueComplete
    ? "bg-emerald-600 text-white"
    : overdue
      ? "bg-red-600 text-white"
      : "bg-zinc-200 text-zinc-800";
  return (
    <span
      data-testid="due-pill"
      data-overdue={overdue ? "true" : "false"}
      data-complete={card.dueComplete ? "true" : "false"}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {formatDue(due)}
    </span>
  );
}
