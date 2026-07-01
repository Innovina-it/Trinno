"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { DateRangePopover, type DateRange } from "@/components/ui/date-range-popover";
import { cn } from "@/lib/utils";
import {
  REPORT_SECTION_KEYS,
  REPORT_SECTION_LABELS,
  ALL_SECTIONS_ON,
  type ReportSectionKey,
} from "@/lib/pma/report-sections";
import { sanitizeReportLength } from "@/lib/pma/report-settings";
import type { RunSummary } from "@/lib/pma/run-status";
import { useReportSections } from "./report-sections-context";
import { ConfigRow } from "./config-row";
import { ReportSectionsFieldset } from "./report-sections-fieldset";
import { ReportSettingsControls } from "./report-settings-controls";
import { ContributorOrgsSection } from "./contributor-orgs-section";
import { AnalysisFolderControl } from "./analysis-folder-control";
import type { ContributorOrgRow } from "@/lib/pma/contributor-orgs-store";

// PMA Analysis workbench (owner/admin). Three panes on a shared history field:
// the runs ledger (left), and the selected item's detail — config + live preview
// — floating as one inset card. "New document" composes the next run; selecting a
// past run shows the settings that produced it (read-only) with a one-click
// restore, plus its report. Run analysis sits in the preview footer.
//
// 0145 (run manager) — a run is a durable background job. A 'running' row shows
// live in the ledger with its stage/progress and a Cancel action; the component
// polls GET /api/pma/run while any run is in flight, so progress advances and a
// finished run flips to its report without a manual refresh. State survives a
// page reload because the running row is server-rendered into `runs`.

export type { RunSummary };

// sections a focus visibly emphasizes in the preview (cosmetic cue — the focus
// actually steers the whole synthesis).
const FOCUSABLE = new Set<ReportSectionKey>([
  "executive_summary",
  "deliverables",
  "notable_changes",
  "quality_risks",
]);
const LEN_LINES = { short: 1, medium: 2, long: 3 } as const;
const LCHIP = { short: "S", medium: "M", long: "L" } as const;

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
type Preset = { label: string; start: Date; target: Date };
function buildPresets(now: Date): Preset[] {
  const t = startOfDayUTC(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  return [
    { label: "This month", start: new Date(Date.UTC(y, m, 1)), target: t },
    { label: "Last month", start: new Date(Date.UTC(y, m - 1, 1)), target: new Date(Date.UTC(y, m, 0)) },
    { label: "Quarter", start: new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)), target: t },
    { label: "YTD", start: new Date(Date.UTC(y, 0, 1)), target: t },
  ];
}
function rangeMatches(v: DateRange, p: Preset): boolean {
  return !!v.start && !!v.target && v.start.getTime() === p.start.getTime() && v.target.getTime() === p.target.getTime();
}
function fmtDay(v: string | Date | null): string | null {
  if (v == null) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
}
function periodLabel(start: string | Date | null, end: string | Date | null): string {
  const s = fmtDay(start);
  const e = fmtDay(end);
  return s && e ? `${s} – ${e}` : "Whole document";
}
function runTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("en-GB", { timeZone: "Europe/Rome", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(",", "");
}
function runSize(run: RunSummary): string {
  const c = run.counts ?? {};
  if (run.status === "empty_period") return "no documents";
  if (run.status === "no_changes") return "no new changes";
  if (run.status === "already_reported") return "already reported";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "error") return "failed";
  const fileN = c.changed ?? 0;
  return [`${fileN} ${fileN === 1 ? "file" : "files"}`, c.missed ? `${c.missed} missed` : null]
    .filter(Boolean)
    .join(" · ");
}

// 0145 — one-line status of an in-flight run for the ledger / running view.
function progressLabel(p: RunSummary["progress"]): string {
  if (!p) return "Starting…";
  switch (p.stage) {
    case "detecting":
      return "Scanning documents…";
    case "analyzing":
      return p.total > 0 ? `Analyzing ${p.done} of ${p.total}` : "Analyzing…";
    case "synthesizing":
      return "Writing the report…";
    default:
      return "Finishing…";
  }
}
function sectionGlyph(s: RunSummary["settings"]): string | null {
  const secs = s?.sections;
  if (!secs) return null;
  const on = Object.values(secs).filter(Boolean).length;
  const total = REPORT_SECTION_KEYS.length;
  return on < total ? `${on}/${total}` : null;
}

export function AnalysisWorkbench({
  workspaceId,
  runs,
  canRun,
  foldersConfigured,
  isOwner,
  sourceUrl,
  contributorOrgRows,
  orgHints,
}: {
  workspaceId: string;
  runs: RunSummary[];
  canRun: boolean;
  foldersConfigured: boolean;
  isOwner: boolean;
  sourceUrl: string | null;
  contributorOrgRows: ContributorOrgRow[];
  orgHints: string[];
}) {
  const router = useRouter();
  const { sections, reportLength, customPrompt, setSections, setReportLength, setCustomPrompt } =
    useReportSections();
  // 0145 — the run rows the ledger renders come from local state so polling can
  // advance an in-flight run's progress without a full page reload. Reseeded
  // whenever the server re-renders fresh props (after router.refresh()).
  const [liveRuns, setLiveRuns] = useState<RunSummary[]>(runs);
  useEffect(() => setLiveRuns(runs), [runs]);
  const activeRun = liveRuns.find((r) => r.status === "running") ?? null;

  const [selected, setSelected] = useState<string>(activeRun ? activeRun.id : "new");
  const [range, setRange] = useState<DateRange>({ start: null, target: null });
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const presets = useMemo(() => buildPresets(new Date()), []);

  // Any run in flight (a running row, or the brief window while POST is starting
  // one) blocks a second run and drives the "Running…" affordance.
  const busy = starting || !!activeRun;

  // Pull the latest run state from the server (used to seed + drive polling).
  const refreshStatus = useCallback(async (): Promise<RunSummary[] | undefined> => {
    try {
      const res = await fetch(`/api/pma/run?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) return undefined;
      const json = (await res.json()) as { runs?: RunSummary[] };
      const next = json?.runs ?? [];
      setLiveRuns(next);
      return next;
    } catch {
      return undefined;
    }
  }, [workspaceId]);

  // Poll while a run is in flight; when it finishes, refresh the server props
  // once so the report link and history text are authoritative, then stop.
  const runningId = activeRun?.id ?? null;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!runningId) {
      if (wasRunning.current) {
        wasRunning.current = false;
        startRefresh(() => router.refresh());
      }
      return;
    }
    wasRunning.current = true;
    let alive = true;
    const id = setInterval(() => {
      if (alive) void refreshStatus();
    }, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runningId, refreshStatus, router]);

  const run = selected === "new" ? null : liveRuns.find((r) => r.id === selected) ?? null;
  const enabled = REPORT_SECTION_KEYS.filter((k) => sections[k]).length;
  const total = REPORT_SECTION_KEYS.length;
  const noneSelected = enabled === 0;
  const focus = customPrompt.trim();
  const curPeriod = range.start && range.target ? `${fmtDay(range.start)} – ${fmtDay(range.target)}` : "Whole document";

  const disabledReason = !canRun
    ? foldersConfigured
      ? "Owner or admin only"
      : "Set a Source and an Output Drive folder first"
    : noneSelected
      ? "Select at least one report section"
      : null;

  function applyPreset(p: Preset) {
    setRange(rangeMatches(range, p) ? { start: null, target: null } : { start: p.start, target: p.target });
  }

  function loadFrom(r: RunSummary) {
    const s = r.settings;
    setSections(s?.sections ? { ...ALL_SECTIONS_ON, ...s.sections } : { ...ALL_SECTIONS_ON });
    setReportLength(sanitizeReportLength(s?.length ?? undefined));
    setCustomPrompt(s?.customPrompt ?? "");
    setRange(
      r.windowStart && r.windowEnd
        ? { start: new Date(r.windowStart), target: new Date(r.windowEnd) }
        : { start: null, target: null },
    );
    setSelected("new");
    setNotice(null);
    setError(null);
  }

  // Re-run a past run's exact settings in one click: reflect them in compose,
  // and fire the run directly with those values (not the not-yet-updated state).
  function reRun(r: RunSummary) {
    const s = r.settings;
    loadFrom(r);
    void doRun({
      sections: s?.sections ? { ...ALL_SECTIONS_ON, ...s.sections } : { ...ALL_SECTIONS_ON },
      reportLength: sanitizeReportLength(s?.length ?? undefined),
      customPrompt: s?.customPrompt ?? "",
      startDate: r.windowStart ?? undefined,
      endDate: r.windowEnd ?? undefined,
    });
  }

  async function doRun(override?: {
    sections: Record<string, boolean>;
    reportLength: string;
    customPrompt: string;
    startDate?: string;
    endDate?: string;
  }) {
    setError(null);
    setNotice(null);
    setStarting(true);
    try {
      const payload = override ?? {
        sections,
        reportLength,
        customPrompt,
        startDate: range.start ? range.start.toISOString() : undefined,
        endDate: range.target ? range.target.toISOString() : undefined,
      };
      // 0145 — the route returns immediately with the new run id (202); the work
      // runs in the background. Select the new run so its progress is in view,
      // then pull status to arm the poll.
      const res = await fetch("/api/pma/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, ...payload }),
      });
      const json = (await res.json().catch(() => null)) as
        | { runId?: string; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "The analysis could not be started.");
        return;
      }
      if (json?.runId) setSelected(json.runId);
      await refreshStatus();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setStarting(false);
    }
  }

  // 0145 — request cancellation of the in-flight run. The row keeps status
  // 'running' until the pipeline notices (between files); polling then flips it
  // to 'cancelled'. cancelRequested (polled) keeps the button in its pending
  // state meanwhile.
  async function cancel(runId: string) {
    setCancelling(true);
    try {
      await fetch("/api/pma/run/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, runId }),
      });
      await refreshStatus();
    } catch {
      // a failed cancel just leaves the run going; the next poll re-reads state
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="grid min-h-[600px] grid-cols-1 overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[#161619] md:grid-cols-[248px_1fr]">
      {/* ── ledger ── */}
      <div className="overflow-y-auto border-b border-[color:var(--hairline)] p-3 md:border-b-0">
        <div className="mono-meta-sm px-1.5 pb-2 text-fg-faint">Runs · {liveRuns.length}</div>
        {canRun && (
          <button
            type="button"
            onClick={() => setSelected("new")}
            className={cn(
              "w-full rounded-lg px-2 py-2 text-left transition-colors",
              selected === "new" ? "bg-[color:var(--surface-strong)]" : "hover:bg-[color:var(--surface)]",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[color:var(--accent-cyan)]">
              <span className="size-[7px] shrink-0 rounded-full bg-[color:var(--accent-cyan)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent-cyan)_16%,transparent)]" />
              New document
            </span>
            <span className="mono-meta-sm ml-3.5 mt-1 block text-fg-faint">blank — compose &amp; run</span>
          </button>
        )}
        {liveRuns.length > 0 && (
          <div className="mono-meta-sm px-1.5 pb-1 pt-3 text-fg-faint">History</div>
        )}
        {liveRuns.map((r) => {
          const isRunning = r.status === "running";
          const ok = r.status === "success" || r.status === "already_reported";
          const dot = isRunning
            ? "bg-[color:var(--accent-cyan)] animate-pulse"
            : r.status === "error"
              ? "bg-[color:var(--status-blocked)]"
              : r.status === "cancelled"
                ? "bg-[color:var(--status-todo)]"
                : ok
                  ? "bg-[color:var(--status-done)]"
                  : "bg-[color:var(--status-todo)]";
          const sg = sectionGlyph(r.settings);
          const len = r.settings?.length && r.status !== "error" ? sanitizeReportLength(r.settings.length) : null;
          const f = r.settings?.customPrompt?.trim();
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={cn(
                "w-full rounded-lg px-2 py-2 text-left transition-colors",
                selected === r.id ? "bg-[color:var(--surface-strong)]" : "hover:bg-[color:var(--surface)]",
                isRunning && "ring-1 ring-inset ring-[color-mix(in_oklch,var(--accent-cyan)_28%,transparent)]",
              )}
            >
              <span className="flex items-center gap-2 text-[0.84rem] font-medium text-fg">
                <span className={cn("size-[7px] shrink-0 rounded-full", dot)} />
                {periodLabel(r.windowStart, r.windowEnd)}
              </span>
              {isRunning ? (
                <>
                  <span className="mono-meta-sm ml-3.5 mt-1 block text-[color:var(--accent-cyan)]">
                    {progressLabel(r.progress)}
                  </span>
                  {canRun && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void cancel(r.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          void cancel(r.id);
                        }
                      }}
                      className="mono-meta-sm ml-3.5 mt-1.5 inline-block rounded border border-[color:var(--hairline)] px-1.5 py-0.5 text-fg-faint hover:text-fg"
                    >
                      {cancelling || r.cancelRequested ? "Cancelling…" : "Cancel"}
                    </span>
                  )}
                </>
              ) : (
                <span className="mono-meta-sm ml-3.5 mt-1 block text-fg-faint">
                  {runTime(r.runAt)} · {runSize(r)}
                </span>
              )}
              {!isRunning && (len || sg || f) && (
                <span className="ml-3.5 mt-1.5 flex flex-wrap items-center gap-1.5">
                  {len && <span className="rounded border border-[color:var(--hairline)] px-1 font-mono text-[0.5rem] uppercase tracking-wider text-fg-faint">{LCHIP[len]}</span>}
                  {sg && <span className="rounded border border-[color:var(--hairline)] px-1 font-mono text-[0.5rem] tracking-wider text-fg-faint">{sg}</span>}
                  {f && <span className="max-w-[110px] truncate font-mono text-[0.55rem] text-[color:var(--accent-cyan)]">◈ {f}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── detail: config flush on the history field; the preview is the only
          padded element — an inset box nested inside. ── */}
      <div className="flex">
        <div className="flex flex-1 flex-col overflow-hidden md:grid md:grid-cols-[1.06fr_1fr] md:rounded-l-2xl md:border-l md:border-[color:var(--hairline)]">
          {/* CONFIG */}
          <div className="flex flex-col px-5 pb-4 pt-1.5">
            {run ? (
              <ReadOnlyConfig run={run} onLoad={() => loadFrom(run)} busy={busy} />
            ) : (
              <div className="divide-y divide-[color:var(--hairline)]">
                <ConfigRow label="Source" align="start">
                  <AnalysisFolderControl bare workspaceId={workspaceId} currentFolderUrl={sourceUrl} />
                </ConfigRow>
                <ConfigRow label="Period" align="start">
                  <div className="flex flex-wrap items-center gap-2">
                    <DateRangePopover value={range} onChange={setRange} disabled={!canRun} triggerLabel="Whole document" />
                    {presets.map((p) => {
                      const active = rangeMatches(range, p);
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => applyPreset(p)}
                          disabled={!canRun}
                          aria-pressed={active}
                          className={cn(
                            "chip mono-meta-sm px-2 py-1 transition-colors disabled:opacity-50",
                            active ? "border-transparent bg-fg text-[#0a0a0a]" : "hover:bg-[color:var(--surface-hi)] hover:text-fg",
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </ConfigRow>
                <ReportSectionsFieldset canRun={canRun} />
                <ReportSettingsControls canRun={canRun} />
                {isOwner && (
                  <ContributorOrgsSection
                    workspaceId={workspaceId}
                    initialRows={contributorOrgRows}
                    canEdit={isOwner}
                    orgHints={orgHints}
                  />
                )}
              </div>
            )}
          </div>

          {/* PREVIEW — the padded inset box. The live outline is warm paper (it
              IS the report doc); a viewed past run stays on the dark console. */}
          <div className="flex p-2.5 md:p-3">
            <div className={cn(
              "flex flex-1 flex-col overflow-hidden rounded-xl border border-[color:var(--hairline)] px-5 py-5",
              run ? "bg-[#0b0b0c]" : "bg-[#f7f5f0]",
            )}>
            {run ? (
              run.status === "running" ? (
                <RunningView
                  run={run}
                  canRun={canRun}
                  cancelling={cancelling}
                  onCancel={() => cancel(run.id)}
                />
              ) : (
                <RunView run={run} canRun={canRun} running={busy} onReRun={() => reRun(run)} />
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[#8f897d]">Preview</span>
                  <span className="flex items-center gap-2">
                    {focus && (
                      <span className="inline-flex max-w-[55%] items-center gap-1 truncate rounded-full bg-[#17150f] px-2 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider text-[#f7f5f0]">
                        ◈ {focus}
                      </span>
                    )}
                    <span className="rounded-full border border-[#17150f]/25 px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-[#6b6459]">
                      new
                    </span>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <div className="text-[1.05rem] font-extrabold tracking-tight text-[#17150f]">Report outline</div>
                  <div className="mb-4 font-mono text-[0.6rem] uppercase tracking-[0.09em] text-[#8f897d]">{curPeriod} · {reportLength}</div>
                  {REPORT_SECTION_KEYS.map((k) => {
                    const on = sections[k];
                    const focused = !!focus && FOCUSABLE.has(k) && on;
                    const lines = (focused ? LEN_LINES[reportLength] + 1 : LEN_LINES[reportLength]);
                    return (
                      <div key={k} className={cn("mb-3.5", !on && "opacity-40")}>
                        <div className={cn("mb-1.5 flex items-center gap-1.5 text-[0.72rem]", focused ? "font-semibold text-[#17150f]" : "text-[#46423a]")}>
                          <span className={cn("size-[5px] rounded-full", focused ? "bg-[#17150f]" : "bg-[#cfc9bd]")} />
                          {REPORT_SECTION_LABELS[k]}
                          {!on && <span className="font-mono text-[0.46rem] uppercase tracking-wider text-[#a8a094]">excluded</span>}
                        </div>
                        {Array.from({ length: lines }).map((_, i) => (
                          <div key={i} className="mb-1 h-1.5 rounded-sm bg-[#e5e0d6]" style={{ width: `${58 + ((k.length * 7 + i * 23) % 40)}%` }} />
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-end gap-3 border-t border-[#e5e0d6] pt-3">
                  <span className="mr-auto font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[#8f897d]">
                    {enabled} of {total} · {reportLength}{focus ? " · focus" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => doRun()}
                    disabled={!canRun || busy || noneSelected}
                    title={(busy ? "An analysis is already running" : disabledReason) ?? undefined}
                    data-testid="pma-run"
                    className="h-9 rounded-full bg-[#17150f] px-4 text-[0.85rem] font-semibold text-[#f7f5f0] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Running…" : "Run analysis"}
                  </button>
                </div>
              </div>
            )}
            {(error || notice) && (
              <div className="mt-2 text-right">
                {error ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[#b42318]" role="alert">{error}</span>
                ) : (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[#8f897d]" role="status">{notice}</span>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Read-only view of the settings a past run used, with one-click restore. A
// still-running run shows a live banner instead (its settings snapshot lands
// when it finishes).
function ReadOnlyConfig({
  run,
  onLoad,
  busy,
}: {
  run: RunSummary;
  onLoad: () => void;
  busy: boolean;
}) {
  const s = run.settings;
  const running = run.status === "running";
  const lenLocked = sanitizeReportLength(s?.length);
  const sg = sectionGlyph(s);
  return (
    <div>
      {running ? (
        <div className="mb-1 mt-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--accent-cyan)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent-cyan)_7%,transparent)] px-3 py-2">
          <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-[color:var(--accent-cyan)]" />
          <span className="font-mono text-[0.56rem] uppercase tracking-wider text-[color:var(--accent-cyan)]">
            {progressLabel(run.progress)}
          </span>
        </div>
      ) : s ? (
        <div className="mb-1 mt-3 flex items-center justify-between gap-2 rounded-lg border border-[color-mix(in_oklch,var(--status-in-progress)_30%,transparent)] bg-[color-mix(in_oklch,var(--status-in-progress)_7%,transparent)] px-3 py-2">
          <span className="font-mono text-[0.56rem] uppercase tracking-wider text-[color:var(--status-in-progress)]">
            Viewing {runTime(run.runAt)}
          </span>
          <button
            type="button"
            onClick={onLoad}
            disabled={busy}
            className="h-[26px] rounded-full bg-fg px-3 text-[0.73rem] font-semibold text-[color:var(--bg-deep)] disabled:opacity-40"
          >
            Load these settings
          </button>
        </div>
      ) : (
        <div className="mb-1 mt-3 rounded-lg border border-[color:var(--hairline)] px-3 py-2 mono-meta-sm text-fg-faint">
          Settings not recorded for this run.
        </div>
      )}
      <div className="divide-y divide-[color:var(--hairline)] opacity-[0.62]">
        <ConfigRow label="Source"><span className="text-[0.82rem] text-fg-muted">☁ Documents folder</span></ConfigRow>
        <ConfigRow label="Period"><span className="text-[0.82rem] text-fg-muted">▦ {periodLabel(run.windowStart, run.windowEnd)}</span></ConfigRow>
        <ConfigRow label="Sections"><span className="text-[0.82rem] text-fg-muted">{sg ? `${sg} sections` : "All sections"}</span></ConfigRow>
        <ConfigRow label="Length">
          <span className="inline-flex gap-0.5 rounded-full border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] p-0.5">
            {(["short", "medium", "long"] as const).map((l) => (
              <span key={l} className={cn("h-6 rounded-full px-2.5 text-xs leading-6", l === lenLocked ? "bg-fg font-medium text-[color:var(--bg-deep)]" : "text-fg-muted")}>
                {l[0].toUpperCase() + l.slice(1)}
              </span>
            ))}
          </span>
        </ConfigRow>
        <ConfigRow label="Focus">
          {s?.customPrompt?.trim() ? (
            <span className="text-[0.82rem] text-[color:var(--accent-cyan)]">◈ {s.customPrompt.trim()}</span>
          ) : (
            <span className="text-[0.82rem] text-fg-faint">— none —</span>
          )}
        </ConfigRow>
      </div>
    </div>
  );
}

// The selected run's report summary + open link (the report body lives in Drive),
// plus a one-click re-run of its settings.
function RunView({
  run,
  canRun,
  running,
  onReRun,
}: {
  run: RunSummary;
  canRun: boolean;
  running: boolean;
  onReRun: () => void;
}) {
  const ok = run.status === "success" || run.status === "already_reported";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="mono-meta-sm text-fg-faint">Report</span>
        <span className={cn("rounded-full px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider", ok ? "border border-[color-mix(in_oklch,var(--status-done)_35%,transparent)] text-[color:var(--status-done)]" : "border border-[color:var(--hairline)] text-fg-faint")}>
          {runTime(run.runAt)}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <div className="text-[1.05rem] font-extrabold tracking-tight">Analysis report</div>
        <div className="mono-meta-sm mb-4 text-fg-faint">{periodLabel(run.windowStart, run.windowEnd)} · {runSize(run)}</div>
        <p className="text-[0.82rem] leading-relaxed text-fg-muted">
          {run.status === "already_reported"
            ? "A report for this period already existed and nothing had changed, so this run points at it. Open it in Drive or re-run its settings on the left."
            : ok
              ? "This run produced a report. Open it in Drive to read the full document; load its settings on the left to re-run or tweak."
              : run.status === "no_changes"
                ? "Nothing changed in this period, so no new report was written."
                : run.status === "empty_period"
                  ? "No documents fell in this period."
                  : run.status === "cancelled"
                    ? "This run was cancelled before a report was produced."
                    : "This run failed before a report was produced."}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-3 border-t border-[color:var(--hairline)] pt-3">
        {run.reportWebViewLink && (
          <a
            href={run.reportWebViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mr-auto")}
          >
            Open report ↗
          </a>
        )}
        {canRun && run.settings && (
          <Button size="sm" variant="secondary" onClick={onReRun} disabled={running}>
            {running ? "Running…" : "Re-run with these settings"}
          </Button>
        )}
      </div>
    </div>
  );
}

// 0145 — the in-flight run's live progress + a Cancel action. Stays on the dark
// console (it is not yet the paper report), with a stage bar that pulses while
// analyzing (determinate) or during the open-ended detect/synthesis stages.
function RunningView({
  run,
  canRun,
  cancelling,
  onCancel,
}: {
  run: RunSummary;
  canRun: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const p = run.progress;
  const pct =
    p && p.stage === "analyzing" && p.total > 0
      ? Math.min(100, Math.round((p.done / p.total) * 100))
      : null;
  const pending = cancelling || run.cancelRequested;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="mono-meta-sm text-fg-faint">Running</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--accent-cyan)_35%,transparent)] px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-[color:var(--accent-cyan)]">
          <span className="size-[6px] animate-pulse rounded-full bg-[color:var(--accent-cyan)]" />
          live
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <div className="text-[1.05rem] font-extrabold tracking-tight">{progressLabel(p)}</div>
        <div className="mono-meta-sm mb-4 text-fg-faint">
          {periodLabel(run.windowStart, run.windowEnd)}
          {pct != null ? ` · ${pct}%` : ""}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-strong)]">
          <div
            className={cn(
              "h-full rounded-full bg-[color:var(--accent-cyan)] transition-[width] duration-500",
              pct == null && "animate-pulse",
            )}
            style={{ width: pct == null ? "40%" : `${pct}%` }}
          />
        </div>
        <p className="mt-4 text-[0.82rem] leading-relaxed text-fg-muted">
          The analysis is running in the background. You can leave this page — it
          keeps going, and the report appears here when it is ready.
        </p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-3 border-t border-[color:var(--hairline)] pt-3">
        {canRun && (
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel run"}
          </Button>
        )}
      </div>
    </div>
  );
}
