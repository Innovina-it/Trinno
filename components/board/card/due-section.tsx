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
    <section className="space-y-2" data-testid="due-section">
      <h3 className="text-sm font-semibold">Due date</h3>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          aria-label="Due date"
          value={value}
          onChange={(e) => persistDate(e.target.value)}
          disabled={pending}
          className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
        />
        {card.dueDate && (
          <>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={card.dueComplete}
                onChange={(e) => toggleComplete(e.target.checked)}
                disabled={pending}
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
