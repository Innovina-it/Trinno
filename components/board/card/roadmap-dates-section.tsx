"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import type { CardRow } from "@/lib/queries/board-snapshot";

const ROADMAP_TYPES = new Set(["epic", "story"]);

function toInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  // YYYY-MM-DD using UTC so the input matches the persisted day across TZs.
  return dt.toISOString().slice(0, 10);
}

function fromInputValue(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function RoadmapDatesSection({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();
  const initStart = card ? toInputValue(card.startDate) : "";
  const initTarget = card ? toInputValue(card.targetDate) : "";
  const [startVal, setStartVal] = useState(initStart);
  const [targetVal, setTargetVal] = useState(initTarget);

  if (!card) return null;
  if (!ROADMAP_TYPES.has(card.type)) return null;

  function persist(field: "start" | "target", next: string) {
    const date = fromInputValue(next);
    if (field === "start") setStartVal(next);
    else setTargetVal(next);
    if (field === "start") updateCardLocal(cardId, { startDate: date });
    else updateCardLocal(cardId, { targetDate: date });
    start(async () => {
      try {
        await updateCard(
          field === "start"
            ? { id: cardId, startDate: date }
            : { id: cardId, targetDate: date },
        );
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function clearBoth() {
    setStartVal("");
    setTargetVal("");
    updateCardLocal(cardId, { startDate: null, targetDate: null });
    start(async () => {
      try {
        await updateCard({
          id: cardId,
          startDate: null,
          targetDate: null,
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="roadmap-dates-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Roadmap dates</h3>
        <span className="mono-meta-sm text-fg-faint">PLAN</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1">
          <span className="mono-meta-sm text-fg-muted">Start</span>
          <input
            type="date"
            aria-label="Roadmap start date"
            value={startVal}
            onChange={(e) => persist("start", e.target.value)}
            disabled={pending}
            className="h-9 rounded-none border border-hairline-hi bg-[color:var(--surface)] px-2.5 py-1 text-sm font-mono text-fg transition-colors focus:border-hairline-hi focus:bg-[color:var(--popover)] outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-meta-sm text-fg-muted">Target</span>
          <input
            type="date"
            aria-label="Roadmap target date"
            value={targetVal}
            onChange={(e) => persist("target", e.target.value)}
            disabled={pending}
            className="h-9 rounded-none border border-hairline-hi bg-[color:var(--surface)] px-2.5 py-1 text-sm font-mono text-fg transition-colors focus:border-hairline-hi focus:bg-[color:var(--popover)] outline-none"
          />
        </label>
        {(startVal || targetVal) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearBoth}
            disabled={pending}
          >
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
