"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { bulkShiftCardDates } from "@/actions/sprints";
import type { SprintConflictCard } from "@/actions/sprints";

// Plan #16b-β — modal that surfaces cards whose dates fall outside the
// sprint window we just started, and offers a one-shot bulk shift to
// pull them in. The suggested delta is the gap between the latest
// `targetDate` past the sprint end and the sprint end itself, so a
// single shift snaps the worst offender to the deadline.

export function SprintDateConflictDialog({
  open,
  onOpenChange,
  conflictCards,
  sprintEndDate,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  conflictCards: SprintConflictCard[];
  sprintEndDate: Date | null;
}) {
  const [pending, startT] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  // Suggest the smallest negative delta (in minutes) that brings every
  // overshooting `targetDate` back to or before the sprint end. If none
  // overshoot, fall back to 0 (the user will see "no shift needed").
  const suggestedDeltaMinutes = useMemo(() => {
    if (!sprintEndDate) return 0;
    let worstOverMs = 0;
    for (const c of conflictCards) {
      if (!c.targetDate) continue;
      const overMs = c.targetDate.getTime() - sprintEndDate.getTime();
      if (overMs > worstOverMs) worstOverMs = overMs;
    }
    if (worstOverMs <= 0) return 0;
    return -Math.ceil(worstOverMs / 60_000);
  }, [conflictCards, sprintEndDate]);

  const deltaDaysLabel = useMemo(() => {
    const days = Math.round(suggestedDeltaMinutes / 60 / 24);
    if (days === 0) return "no shift";
    return `${days > 0 ? "+" : ""}${days} day${Math.abs(days) === 1 ? "" : "s"}`;
  }, [suggestedDeltaMinutes]);

  function onConfirm() {
    if (suggestedDeltaMinutes === 0) {
      onOpenChange(false);
      return;
    }
    startT(async () => {
      try {
        const ids = conflictCards.map((c) => c.id);
        const r = await bulkShiftCardDates({
          cardIds: ids,
          deltaMinutes: suggestedDeltaMinutes,
        });
        toast.success(`Shifted ${r.updated} card${r.updated === 1 ? "" : "s"}`);
        setDone(true);
        router.refresh();
        onOpenChange(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="sprint-conflict-dialog"
      >
        <DialogHeader>
          <DialogTitle>Some cards land outside the sprint</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-fg-muted">
            {conflictCards.length} card
            {conflictCards.length === 1 ? "" : "s"} have start or target dates
            outside the active window. Shift them by{" "}
            <strong>{deltaDaysLabel}</strong> so they fit?
          </p>
          <ul className="max-h-56 overflow-auto space-y-1 border border-hairline rounded-lg p-2">
            {conflictCards.map((c) => (
              <li
                key={c.id}
                className="flex items-baseline justify-between gap-3"
                data-testid="sprint-conflict-row"
                data-card-id={c.id}
              >
                <span className="truncate">{c.title}</span>
                <span className="mono-meta-sm text-fg-faint shrink-0">
                  {c.startDate
                    ? c.startDate.toISOString().slice(0, 10)
                    : "?"}
                  {" → "}
                  {c.targetDate
                    ? c.targetDate.toISOString().slice(0, 10)
                    : "?"}
                </span>
              </li>
            ))}
          </ul>
          {done && (
            <p className="mono-meta-sm text-fg-faint">Shift applied.</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Skip
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending || suggestedDeltaMinutes === 0}
            data-testid="sprint-conflict-confirm"
          >
            {pending ? "Shifting…" : `Shift dates (${deltaDaysLabel})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
