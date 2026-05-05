"use client";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { dueCode } from "@/lib/format";

export function DuePill({ card }: { card: CardRow }) {
  if (!card.dueDate) return null;
  const due = card.dueDate instanceof Date ? card.dueDate : new Date(card.dueDate);
  const overdue = !card.dueComplete && due.getTime() < Date.now();

  // Sanctioned chroma only: status-blocked for overdue, status-done for
  // complete. Idle (future) due is neutral mono on hairline.
  const style: React.CSSProperties | undefined = card.dueComplete
    ? {
        color: "var(--status-done)",
        boxShadow:
          "inset 0 0 0 1px color-mix(in oklab, var(--status-done) 50%, transparent)",
      }
    : overdue
      ? {
          color: "var(--status-blocked)",
          boxShadow:
            "inset 0 0 0 1px color-mix(in oklab, var(--status-blocked) 50%, transparent)",
        }
      : undefined;

  return (
    <span
      data-testid="due-pill"
      data-overdue={overdue ? "true" : "false"}
      data-complete={card.dueComplete ? "true" : "false"}
      className="chip mono-meta-sm inline-flex items-center gap-1.5 tabular-nums"
      style={style}
    >
      <span className="opacity-60">DUE</span>
      <span className={card.dueComplete ? "line-through decoration-current/60" : ""}>
        {dueCode(due)}
      </span>
    </span>
  );
}
