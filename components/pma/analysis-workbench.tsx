"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DateRangePopover, type DateRange } from "@/components/ui/date-range-popover";
import { cn } from "@/lib/utils";
import {
  REPORT_SECTION_KEYS,
  REPORT_SECTION_LABELS,
  ALL_SECTIONS_ON,
  type ReportSectionKey,
} from "@/lib/pma/report-sections";
import { sanitizeReportLength } from "@/lib/pma/report-settings";
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

export type RunSummary = {
  id: string;
  runAt: string | null;
  status: string | null;
  counts: Record<string, number> | null;
  reportWebViewLink: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  settings: {
    sections?: Record<string, boolean> | null;
    length?: string;
    customPrompt?: string | null;
  } | null;
};

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
  if (run.status === "error") return "failed";
  const fileN = c.changed ?? 0;
  return [`${fileN} ${fileN === 1 ? "file" : "files"}`, c.missed ? `${c.missed} missed` : null]
    .filter(Boolean)
    .join(" · ");
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
  const [selected, setSelected] = useState<string>("new");
  const [range, setRange] = useState<DateRange>({ start: null, target: null });
  const [running, setRunning] = useState(false);
  const [, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const presets = useMemo(() => buildPresets(new Date()), []);

  const run = selected === "new" ? null : runs.find((r) => r.id === selected) ?? null;
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
    const s = r.settings ?? {};
    setSections(s.sections ? { ...ALL_SECTIONS_ON, ...s.sections } : { ...ALL_SECTIONS_ON });
    setReportLength(sanitizeReportLength(s.length));
    setCustomPrompt(s.customPrompt ?? "");
    setRange(
      r.windowStart && r.windowEnd
        ? { start: new Date(r.windowStart), target: new Date(r.windowEnd) }
        : { start: null, target: null },
    );
    setSelected("new");
    setNotice(null);
    setError(null);
  }

  async function doRun() {
    setError(null);
    setNotice(null);
    setRunning(true);
    try {
      const res = await fetch("/api/pma/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          startDate: range.start ? range.start.toISOString() : undefined,
          endDate: range.target ? range.target.toISOString() : undefined,
          sections,
          reportLength,
          customPrompt,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { result?: { status?: string }; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "The analysis could not be completed.");
        return;
      }
      const status = json?.result?.status;
      if (status === "already_reported")
        setNotice("A report for this period already exists — nothing changed since.");
      else if (status === "empty_period") setNotice("No documents in the selected period.");
      else if (status === "no_changes") setNotice("No new changes in the selected period.");
      startRefresh(() => router.refresh());
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[#0d0d0e] md:grid-cols-[186px_1fr]">
      {/* ── ledger ── */}
      <div className="overflow-y-auto border-b border-[color:var(--hairline)] p-3 md:border-b-0">
        <div className="mono-meta-sm px-1.5 pb-2 text-fg-faint">Runs · {runs.length}</div>
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
        {runs.length > 0 && (
          <div className="mono-meta-sm px-1.5 pb-1 pt-3 text-fg-faint">History</div>
        )}
        {runs.map((r) => {
          const ok = r.status === "success";
          const dot = r.status === "error" ? "bg-[color:var(--status-blocked)]" : ok ? "bg-[color:var(--status-done)]" : "bg-[color:var(--status-todo)]";
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
              )}
            >
              <span className="flex items-center gap-2 text-[0.84rem] font-medium text-fg">
                <span className={cn("size-[7px] shrink-0 rounded-full", dot)} />
                {periodLabel(r.windowStart, r.windowEnd)}
              </span>
              <span className="mono-meta-sm ml-3.5 mt-1 block text-fg-faint">
                {runTime(r.runAt)} · {runSize(r)}
              </span>
              {(len || sg || f) && (
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

      {/* ── detail card (config + preview) floating on the history field ── */}
      <div className="flex p-3 md:py-3.5 md:pl-1 md:pr-3.5">
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-gradient-to-b from-[#0c0c0c] to-[#080808] md:grid md:grid-cols-[1fr_0.96fr]">
          {/* CONFIG */}
          <div className="flex flex-col px-5 pb-3 pt-1">
            {run ? (
              <ReadOnlyConfig run={run} onLoad={() => loadFrom(run)} />
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

          {/* PREVIEW / REPORT */}
          <div className="flex flex-col border-t border-[color:var(--hairline)] bg-[#0b0b0c] px-5 py-4 md:border-l md:border-t-0">
            {run ? (
              <RunView run={run} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="mono-meta-sm text-fg-faint">Preview</span>
                  <span className="flex items-center gap-2">
                    {focus && (
                      <span className="inline-flex max-w-[55%] items-center gap-1 truncate rounded-full border border-[color-mix(in_oklch,var(--accent-cyan)_40%,transparent)] px-2 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider text-[color:var(--accent-cyan)]">
                        ◈ {focus}
                      </span>
                    )}
                    <span className="rounded-full border border-[color-mix(in_oklch,var(--accent-cyan)_35%,transparent)] px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-[color:var(--accent-cyan)]">
                      new
                    </span>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <div className="text-[1.05rem] font-extrabold tracking-tight">Report outline</div>
                  <div className="mono-meta-sm mb-4 text-fg-faint">{curPeriod} · {reportLength}</div>
                  {REPORT_SECTION_KEYS.map((k) => {
                    const on = sections[k];
                    const focused = !!focus && FOCUSABLE.has(k) && on;
                    const lines = (focused ? LEN_LINES[reportLength] + 1 : LEN_LINES[reportLength]);
                    return (
                      <div key={k} className={cn("mb-2.5", !on && "opacity-[0.16]")}>
                        <div className={cn("mb-1.5 flex items-center gap-1.5 text-[0.72rem]", focused ? "text-[color:var(--accent-cyan)]" : "text-fg-muted")}>
                          <span className={cn("size-[5px] rounded-full", focused ? "bg-[color:var(--accent-cyan)]" : "bg-[color:var(--hairline-hi)]")} />
                          {REPORT_SECTION_LABELS[k]}
                          {!on && <span className="font-mono text-[0.46rem] uppercase tracking-wider text-fg-faint">excluded</span>}
                        </div>
                        {Array.from({ length: lines }).map((_, i) => (
                          <div key={i} className="mb-1 h-1.5 rounded-sm bg-[color:var(--surface-strong)]" style={{ width: `${58 + ((k.length * 7 + i * 23) % 40)}%` }} />
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-end gap-3 border-t border-[color:var(--hairline)] pt-3">
                  <span className="mono-meta-sm mr-auto text-fg-faint">
                    {enabled} of {total} · {reportLength}{focus ? " · focus" : ""}
                  </span>
                  <Button size="sm" onClick={doRun} disabled={!canRun || running || noneSelected} title={disabledReason ?? undefined} data-testid="pma-run">
                    {running ? "Running…" : "Run analysis"}
                  </Button>
                </div>
              </div>
            )}
            {(error || notice) && (
              <div className="mt-2 text-right">
                {error ? (
                  <span className="mono-meta-sm text-[color:var(--accent-magenta)]" role="alert">{error}</span>
                ) : (
                  <span className="mono-meta-sm text-fg-faint" role="status">{notice}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Read-only view of the settings a past run used, with one-click restore.
function ReadOnlyConfig({ run, onLoad }: { run: RunSummary; onLoad: () => void }) {
  const s = run.settings;
  const lenLocked = sanitizeReportLength(s?.length);
  const sg = sectionGlyph(s);
  return (
    <div>
      {s ? (
        <div className="mb-1 mt-3 flex items-center justify-between gap-2 rounded-lg border border-[color-mix(in_oklch,var(--status-in-progress)_30%,transparent)] bg-[color-mix(in_oklch,var(--status-in-progress)_7%,transparent)] px-3 py-2">
          <span className="font-mono text-[0.56rem] uppercase tracking-wider text-[color:var(--status-in-progress)]">
            Viewing {runTime(run.runAt)}
          </span>
          <button type="button" onClick={onLoad} className="h-[26px] rounded-full bg-fg px-3 text-[0.73rem] font-semibold text-[color:var(--bg-deep)]">
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

// The selected run's report summary + open link (the report body lives in Drive).
function RunView({ run }: { run: RunSummary }) {
  const ok = run.status === "success";
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
          {ok
            ? "This run produced a report. Open it in Drive to read the full document; load its settings on the left to re-run or tweak."
            : run.status === "no_changes"
              ? "Nothing changed in this period, so no new report was written."
              : run.status === "empty_period"
                ? "No documents fell in this period."
                : "This run failed before a report was produced."}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-3 border-t border-[color:var(--hairline)] pt-3">
        {run.reportWebViewLink && (
          <a href={run.reportWebViewLink} target="_blank" rel="noopener noreferrer" className="mr-auto mono-meta-sm text-[color:var(--accent-cyan)] hover:underline">
            Open report ↗
          </a>
        )}
      </div>
    </div>
  );
}
