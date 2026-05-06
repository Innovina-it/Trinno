"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import { DatePopover } from "@/components/ui/date-range-popover";
import type { CardRow } from "@/lib/queries/board-snapshot";

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

export function DueSection({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();

  if (!card) return null;

  const value = toDate(card.dueDate);

  function persist(next: Date | null) {
    // Persist as noon UTC so the date doesn't shift across time zones.
    const dueDate = next
      ? new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 12))
      : null;
    const patch = next
      ? { dueDate }
      : { dueDate: null, dueComplete: false };
    updateCardLocal(cardId, patch);
    start(async () => {
      try {
        await updateCard({ id: cardId, ...patch });
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
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Due date</h3>
        {pending && <span className="mono-meta-sm text-fg-faint">SAVING…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DatePopover
          value={value}
          onChange={persist}
          disabled={pending}
          triggerLabel="Set due date"
        />
        {card.dueDate && (
          <label className="flex items-center gap-1.5 mono-meta text-fg/75">
            <input
              type="checkbox"
              checked={card.dueComplete}
              onChange={(e) => toggleComplete(e.target.checked)}
              disabled={pending}
              className="size-3.5"
            />
            Mark complete
          </label>
        )}
      </div>
    </section>
  );
}
