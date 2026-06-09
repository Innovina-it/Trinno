"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DateRangePopover,
  type DateRange,
} from "@/components/ui/date-range-popover";

// PMA U10 — the "Run analysis" control. Owner/admin only, disabled until both
// Drive folders are configured (the route enforces the same; this is the
// affordance + the reason). A run makes a real Gemini Pro pass so it can take
// tens of seconds — the button reports progress and refreshes the server list
// on success.
//
// U12.3 — a DateRangePopover (the shared calendar) scopes the run to a period;
// defaults to the last 7 days (today−7d → today, UTC). The window is posted as
// {startDate,endDate}; the route (U12.2) clamps + validates it.

const MS_DAY = 86_400_000;
function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function RunAnalysisPanel({
  workspaceId,
  canRun,
  isOwnerAdmin,
  foldersConfigured,
}: {
  workspaceId: string;
  canRun: boolean;
  isOwnerAdmin: boolean;
  foldersConfigured: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Default window: the last 7 days (today−7d → today), in UTC day terms.
  const [range, setRange] = useState<DateRange>(() => {
    const today = startOfDayUTC(new Date());
    return { start: new Date(today.getTime() - 7 * MS_DAY), target: today };
  });

  const disabledReason = !isOwnerAdmin
    ? "Owner or admin only"
    : !foldersConfigured
      ? "Set a Source and an Output Drive folder in settings first"
      : null;

  const busy = running || refreshing;

  async function run() {
    setError(null);
    setNotice(null);
    setRunning(true);
    try {
      const res = await fetch("/api/pma/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          // U12.3 — the chosen window; absent ends default to last-7-days route-side.
          startDate: range.start ? range.start.toISOString() : undefined,
          endDate: range.target ? range.target.toISOString() : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { result?: { status?: string }; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "The analysis could not be completed.");
        return;
      }
      // U12.5 — an empty-window run produces no report; tell the user inline
      // (the run still appears in history with the same notice).
      if (json?.result?.status === "no_changes") {
        setNotice("Nessuna nuova modifica nel periodo selezionato.");
      }
      startRefresh(() => router.refresh());
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <DateRangePopover
          value={range}
          onChange={setRange}
          disabled={!canRun || busy}
          triggerLabel="Set period"
        />
        <Button
          size="sm"
          onClick={run}
          disabled={!canRun || busy}
          title={disabledReason ?? undefined}
          data-testid="pma-run"
        >
          {running ? "Running…" : refreshing ? "Loading…" : "Run analysis"}
        </Button>
      </div>
      {disabledReason && (
        <span className="mono-meta-sm text-fg-faint">{disabledReason}</span>
      )}
      {error && (
        <span className="mono-meta-sm text-red-400" role="alert">
          {error}
        </span>
      )}
      {notice && !error && (
        <span className="mono-meta-sm text-fg-faint" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
