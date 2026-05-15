"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bulkShiftCardDates } from "@/actions/sprints";

export function SprintShiftDatesButton({
  cardIds,
}: {
  cardIds: string[];
}) {
  const [days, setDays] = useState(7);
  const [pending, start] = useTransition();
  const router = useRouter();

  function apply() {
    if (cardIds.length === 0 || days === 0) return;
    start(async () => {
      try {
        // Server action schema caps at 50 IDs per call. Batch.
        const BATCH = 50;
        let updated = 0;
        for (let i = 0; i < cardIds.length; i += BATCH) {
          const r = await bulkShiftCardDates({
            cardIds: cardIds.slice(i, i + BATCH),
            deltaMinutes: days * 24 * 60,
          });
          updated += r.updated;
        }
        toast.success(
          `Shifted ${updated} card${updated === 1 ? "" : "s"} by ${days > 0 ? "+" : ""}${days} day${Math.abs(days) === 1 ? "" : "s"}`,
        );
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div
      className="flex items-center gap-2"
      data-testid="sprint-shift-dates"
    >
      <label className="mono-meta-sm text-fg-muted" htmlFor="sprint-shift-days">
        SHIFT BY
      </label>
      <input
        id="sprint-shift-days"
        data-testid="sprint-shift-days-input"
        type="number"
        value={days}
        onChange={(e) => setDays(Number(e.target.value) || 0)}
        disabled={pending}
        className="h-8 w-16 rounded-md border border-hairline-hi bg-[color:var(--surface)] px-2 text-fg tabular-nums"
      />
      <span className="mono-meta-sm text-fg-muted">DAYS</span>
      <Button
        type="button"
        size="sm"
        onClick={apply}
        disabled={pending || cardIds.length === 0 || days === 0}
        data-testid="sprint-shift-dates-apply"
      >
        {pending ? "Shifting…" : "Apply"}
      </Button>
    </div>
  );
}
