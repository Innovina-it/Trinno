"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import { DateRangePopover, type DateRange } from "@/components/ui/date-range-popover";
import type { CardRow } from "@/lib/queries/board-snapshot";

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  // Normalize to UTC midnight so the calendar grid matches the persisted day.
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

export function RoadmapDatesSection({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();

  if (!card) return null;

  const value: DateRange = {
    start: toDate(card.startDate),
    target: toDate(card.targetDate),
  };

  function persist(next: DateRange) {
    updateCardLocal(cardId, { startDate: next.start, targetDate: next.target });
    start(async () => {
      try {
        await updateCard({
          id: cardId,
          startDate: next.start,
          targetDate: next.target,
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-2" data-testid="roadmap-dates-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Dates</h3>
        {pending && <span className="mono-meta-sm text-fg-faint">SAVING…</span>}
      </div>
      <DateRangePopover
        value={value}
        onChange={persist}
        disabled={pending}
        triggerLabel="Set start / target"
      />
    </section>
  );
}
