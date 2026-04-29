"use client";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { dueCode } from "@/lib/format";

export function DuePill({ card }: { card: CardRow }) {
  if (!card.dueDate) return null;
  const due = card.dueDate instanceof Date ? card.dueDate : new Date(card.dueDate);
  const overdue = !card.dueComplete && due.getTime() < Date.now();

  // Editorial: square pill, mono uppercase, hairline ink border.
  // Overdue → signal orange foreground/border. Complete → moss green.
  const tone = card.dueComplete
    ? "border-moss text-moss line-through decoration-moss/60"
    : overdue
      ? "border-signal text-signal"
      : "border-ink/60 text-ink/75";

  return (
    <span
      data-testid="due-pill"
      data-overdue={overdue ? "true" : "false"}
      data-complete={card.dueComplete ? "true" : "false"}
      className={`mono-meta-sm inline-flex items-center gap-1.5 border bg-paper px-1.5 py-0.5 ${tone}`}
    >
      <span className="opacity-50">DUE</span>
      <span>{dueCode(due)}</span>
    </span>
  );
}
