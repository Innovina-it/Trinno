"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import type { CardRow } from "@/lib/queries/board-snapshot";

function toInputValue(d: Date | string | null): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  // YYYY-MM-DD in local time
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DueSection({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();
  const [value, setValue] = useState<string>(
    card ? toInputValue(card.dueDate) : "",
  );

  if (!card) return null;

  function persistDate(next: string) {
    setValue(next);
    const dueDate = next ? new Date(next + "T12:00:00") : null;
    updateCardLocal(cardId, { dueDate });
    start(async () => {
      try {
        await updateCard({ id: cardId, dueDate });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function clearDate() {
    setValue("");
    updateCardLocal(cardId, { dueDate: null, dueComplete: false });
    start(async () => {
      try {
        await updateCard({ id: cardId, dueDate: null, dueComplete: false });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function toggleComplete(checked: boolean) {
    updateCardLocal(cardId, { dueComplete: checked });
    start(async () => {
      try {
        await updateCard({ id: cardId, dueComplete: checked });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="due-section">
      <div className="flex items-baseline justify-between border-b border-rule pb-1">
        <h3 className="mono-meta text-ink/70">Due date</h3>
        <span className="mono-meta-sm text-ink/35">DT</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          aria-label="Due date"
          value={value}
          onChange={(e) => persistDate(e.target.value)}
          disabled={pending}
          className="h-9 rounded-none border border-ink/70 bg-paper-shadow px-2.5 py-1 text-sm font-mono text-ink transition-colors focus:border-ink focus:bg-paper outline-none"
        />
        {card.dueDate && (
          <>
            <label className="flex items-center gap-1.5 mono-meta text-ink/75">
              <input
                type="checkbox"
                checked={card.dueComplete}
                onChange={(e) => toggleComplete(e.target.checked)}
                disabled={pending}
                className="size-3.5"
              />
              Mark complete
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearDate}
              disabled={pending}
            >
              Clear
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
