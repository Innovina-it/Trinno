"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DateRangePopover,
  type DateRange,
} from "@/components/ui/date-range-popover";
import { useReportSections } from "./report-sections-context";

// PMA U10 — the "Run analysis" control. Owner/admin only, disabled until both
// Drive folders are configured (the route enforces the same; this is the
// affordance + the reason). A run makes a real Gemini Pro pass so it can take
// tens of seconds — the button reports progress and refreshes the server list
// on success.
//
// U12.3/U12.10 — a DateRangePopover (the shared calendar) optionally scopes the
// run to a period. It starts EMPTY: no date → whole-document report. When a range
// is picked it's posted as {startDate,endDate}; the route clamps + validates it.

// dd/mm/yyyy (UTC, no time) — for the "available range" hint on an empty period.
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// U12.x — analysis-only quick windows below the picker. Unlike the shared
// DateRangePopover's in-popover presets (which count FORWARD from today), these
// are BACKWARD calendar windows — the natural shape for scoping a report over
// documents that already exist. UTC, start-of-day, to match the picker.
function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
type PresetChip = { label: string; start: Date; target: Date };
function buildPresets(now: Date): PresetChip[] {
  const today = startOfDayUTC(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  return [
    { label: "This month", start: new Date(Date.UTC(y, m, 1)), target: today },
    {
      label: "Last month",
      start: new Date(Date.UTC(y, m - 1, 1)),
      // Day 0 of the current month = last day of the previous month.
      target: new Date(Date.UTC(y, m, 0)),
    },
    {
      label: "Quarter",
      // Quarter-to-date: first day of the current calendar quarter → today.
      start: new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)),
      target: today,
    },
    { label: "YTD", start: new Date(Date.UTC(y, 0, 1)), target: today },
  ];
}
function rangeMatches(value: DateRange, p: PresetChip): boolean {
  return (
    !!value.start &&
    !!value.target &&
    value.start.getTime() === p.start.getTime() &&
    value.target.getTime() === p.target.getTime()
  );
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
  // U12.10 — empty by default: no date = whole-document report.
  const [range, setRange] = useState<DateRange>({ start: null, target: null });
  // U3 — the report-section selection, shared with the checkbox fieldset below
  // the Documents-folder control; posted with the run (which also persists it).
  const { sections } = useReportSections();
  // Quick windows computed once per mount (relative to today).
  const presets = useMemo(() => buildPresets(new Date()), []);

  // Clicking a chip fills the range; clicking the active one toggles back to
  // whole-document (empty).
  function applyPreset(p: PresetChip) {
    setRange(
      rangeMatches(range, p)
        ? { start: null, target: null }
        : { start: p.start, target: p.target },
    );
  }

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
          // U3 — which sections to render; the run also persists this combination.
          sections,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            result?: {
              status?: string;
              availableRange?: { first: string | null; last: string | null } | null;
              changedSince?: string[];
            };
            error?: { message?: string };
          }
        | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "The analysis could not be completed.");
        return;
      }
      // Inline feedback by status (the run also appears in history). Phrase by
      // whether a PERIOD was chosen: with no date it's a whole-document run, so
      // "selected period" wording would be wrong.
      const status = json?.result?.status;
      const changedSince = json?.result?.changedSince;
      if (status === "already_reported") {
        // U12.12 — same period, nothing changed → no duplicate; the existing
        // report is already in the list below.
        setNotice(
          "A report for this period already exists — nothing changed since (see below).",
        );
      } else if (status === "empty_period" || status === "no_changes") {
        const hasPeriod = !!(range.start && range.target);
        const r = json?.result?.availableRange;
        const hint =
          r?.first && r?.last
            ? ` Documents range from ${fmtDay(r.first)} to ${fmtDay(r.last)}.`
            : "";
        if (!hasPeriod) {
          setNotice(`No documents to analyze in the Source folder.${hint}`);
        } else if (status === "empty_period") {
          setNotice(`No documents in the selected period.${hint}`);
        } else {
          setNotice("No new changes in the selected period.");
        }
      } else if (status === "success" && changedSince && changedSince.length > 0) {
        // U12.12 — re-run of the same period that DID change: say what changed.
        setNotice(
          `Report updated. Changed since the last report for this period: ${changedSince.join(", ")}.`,
        );
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
          triggerLabel="Whole document"
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
      <div
        className="flex flex-wrap items-center justify-center gap-1.5 self-stretch"
        data-testid="pma-presets"
      >
        {presets.map((p) => {
          const active = rangeMatches(range, p);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              disabled={!canRun || busy}
              aria-pressed={active}
              className={
                "chip mono-meta-sm px-2 py-1 transition-colors disabled:opacity-50 " +
                (active
                  ? "border-transparent bg-fg text-[#0a0a0a] hover:bg-fg"
                  : "hover:bg-[color:var(--surface-hi)] hover:text-fg")
              }
            >
              {p.label}
            </button>
          );
        })}
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
