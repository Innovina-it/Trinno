"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { CalendarRange } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { updateCard } from "@/actions/cards";
import { DateRangePopover, type DateRange } from "@/components/ui/date-range-popover";
import { Button } from "@/components/ui/button";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { undoBus } from "@/lib/undo-bus";

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
  const parent = useBoardStore((s) =>
    card?.parentCardId
      ? s.cards.find((c) => c.id === card.parentCardId)
      : null,
  ) as CardRow | undefined | null;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const isGuest = useIsGuest();
  const [pending, start] = useTransition();

  if (!card) return null;

  const currentCard = card;
  const value: DateRange = {
    start: toDate(currentCard.startDate),
    target: toDate(currentCard.targetDate),
  };

  // Subtask date inheritance signal: if this card has a parent and both
  // start and target match the parent's, the values were copied at
  // create-time (see actions/cards.ts createCardImpl). Surface that so
  // the user understands why dates appeared without explicit input.
  const parentStart = parent ? toDate(parent.startDate) : null;
  const parentTarget = parent ? toDate(parent.targetDate) : null;
  const inheritedFromParent =
    !!parent &&
    !!value.start &&
    !!value.target &&
    !!parentStart &&
    !!parentTarget &&
    value.start.getTime() === parentStart.getTime() &&
    value.target.getTime() === parentTarget.getTime();

  function persist(next: DateRange) {
    const prev = {
      startDate: currentCard.startDate,
      targetDate: currentCard.targetDate,
    };
    updateCardLocal(cardId, { startDate: next.start, targetDate: next.target });
    start(async () => {
      try {
        await updateCard({
          id: cardId,
          startDate: next.start,
          targetDate: next.target,
        });
        undoBus.push({
          message: "Roadmap dates updated",
          undo: async () => {
            updateCardLocal(cardId, prev);
            try {
              await updateCard({
                id: cardId,
                startDate: prev.startDate,
                targetDate: prev.targetDate,
              });
            } catch (err) {
              updateCardLocal(cardId, {
                startDate: next.start,
                targetDate: next.target,
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        updateCardLocal(cardId, prev);
        toast.error((err as Error).message);
      }
    });
  }

  const onRoadmap = Boolean(value.start && value.target);

  function promote() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const week = new Date(today.getTime() + 7 * 86_400_000);
    persist({ start: today, target: week });
  }

  if (isGuest) {
    if (!value.start && !value.target) return null;
    const fmt = (d: Date | null) =>
      d ? d.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
    return (
      <section className="space-y-2" data-testid="roadmap-dates-section">
        <div className="flex items-baseline justify-between border-b border-hairline pb-1">
          <h3 className="mono-meta text-fg-muted">Dates</h3>
          <span className="mono-meta-sm text-fg-faint">UTC</span>
        </div>
        <p className="text-sm text-fg">
          {fmt(value.start)} → {fmt(value.target)}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="roadmap-dates-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Dates</h3>
        <div className="flex items-baseline gap-2">
          {/* Persistence hint: dates are stored & rendered as UTC midnight
              (see toDate above). Surfacing the timezone here pre-empts the
              "why does my Friday show as Thursday in Tokyo" support thread. */}
          <span className="mono-meta-sm text-fg-faint">UTC</span>
          {pending && <span className="mono-meta-sm text-fg-faint">SAVING…</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePopover
          value={value}
          onChange={persist}
          disabled={pending}
          triggerLabel="Set start / target"
        />
        {inheritedFromParent && (
          <span
            data-testid="roadmap-dates-inherited"
            className="mono-meta-sm text-fg-faint"
          >
            INHERITED FROM PARENT
          </span>
        )}
      </div>
      {!onRoadmap && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={promote}
          disabled={pending}
          data-testid="roadmap-promote"
          className="gap-1.5 normal-case tracking-normal"
        >
          <CalendarRange className="size-3" />
          Promote to roadmap (today + 7 days)
        </Button>
      )}
    </section>
  );
}
