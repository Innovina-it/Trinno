import "server-only";

import { StructuredError } from "@/lib/errors/structured-error";
import { withWorkspaceRunLock } from "@/lib/db/client";
import { detect, type DetectedFile } from "./detect";
import { analyze } from "./analyze";
import { synthesize } from "./synthesize";
import { reconcile } from "./reconcile";
import {
  findRunByWindow,
  setWorkspaceReportSections,
  setWorkspaceReportSettings,
  getWorkspaceReportSettings,
} from "./registry";
import type { ReportLength } from "./report-settings";
import { getRunInputs } from "./inputs";
import { getProjectBrief } from "./context";
import { listContributorOrgs } from "./contributor-orgs-store";
import type { ReportSections } from "./report-sections";

// PMA U9 — RUN ORCHESTRATION (DESIGN §3, the A→G pipeline). Windowed as of U12.2.
//
// Wires the whole "Run analysis" behind the route's owner/admin gate:
//   inputs → precondition → A detect (WINDOW) → D analyze → E synthesize
//   (terminal on failure) → G reconcile.
//
// Service-role vs user: getRunInputs reads OUR Postgres as the acting user
// (RLS). detect/analyze/synthesize touch Drive + Gemini and reconcile/registry
// write service-role — all server-only, no client exposure.
//
// WINDOW SCOPE (U12.2): the run is scoped to an explicit [start,end] date window
// (the route always supplies one; default = the last 7 days). detect lists the
// Source folder and keeps files modified in the window — the Drive Changes-API
// page-token / incremental checkpoint is no longer read or advanced by this
// path. The version gate still skips files already analysed at their current
// version, so an unchanged in-window file is not re-generated (it surfaces as a
// "no changes" run in U12.5).

export type RunAnalysisInput = {
  token: string;
  workspaceId: string;
  actorId: string;
  now: string; // ISO timestamp (run clock)
  runLabel: string; // display label (UTC+1) for the report Doc
  // U12.2 — the reporting window (ISO timestamps, inclusive) the run is scoped to.
  // U12.10 — OPTIONAL: omitted → whole-document report (all files, no date filter).
  window?: { start: string; end: string };
  // U3 — the per-workspace report-section selection chosen in the run panel.
  // Saved at run start (remembered for next time) and applied to the rendered
  // report. Absent → leaves the saved combination untouched + all sections on.
  sections?: ReportSections;
  // 0143 — per-workspace report length + custom focus from the run panel. Saved
  // at run start and applied to the synthesis prompt. Absent → the workspace's
  // saved value (or 'medium' / no focus) is used, so a non-panel run still
  // honours a standing focus.
  reportLength?: ReportLength;
  customPrompt?: string | null;
};

export type RunAnalysisResult = {
  runId: string;
  // U12.5 — "no_changes": files existed in the window but none changed.
  // U12.7 — "empty_period": no documents at all were modified in the window.
  // U12.12 — "already_reported": an identical-window run with the same content
  //   fingerprint already produced a report; we point at it, no new Doc.
  // All three produce NO new report Doc (just a notice / a link).
  status: "success" | "error" | "no_changes" | "empty_period" | "already_reported";
  reportFileId: string | null;
  reportWebViewLink: string | null;
  counts: {
    changed: number;
    missed: number;
    removed: number;
    deliverables?: number;
  } | null;
  registered: number;
  errored: number;
  removedApplied: number;
  bootstrapped: boolean;
  // U12.10 — on an empty windowed run, the documents' available date range (oldest
  // createdTime → newest modifiedTime) so the UI can guide the user. null otherwise.
  availableRange?: { first: string | null; last: string | null } | null;
  // U12.12 — when regenerating a same-window report, the files that changed since
  // the previous report of this period (names). Empty/absent otherwise.
  changedSince?: string[];
};

// U12.12 — content fingerprint of the in-window files: {fileId: driveVersion}.
// Equal fingerprint for the same window ⇒ nothing changed since the last report.
function fingerprintOf(files: DetectedFile[]): Record<string, string> {
  const fp: Record<string, string> = {};
  for (const f of files) fp[f.fileId] = f.version ?? "";
  return fp;
}

function sameFingerprint(
  a: Record<string, string> | null | undefined,
  b: Record<string, string>,
): boolean {
  if (!a) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

// Names of files new or version-changed vs a prior run's fingerprint.
function changedFiles(
  prior: Record<string, string> | null | undefined,
  current: DetectedFile[],
): string[] {
  const names: string[] = [];
  for (const f of current) {
    const was = prior?.[f.fileId];
    if (was === undefined || was !== (f.version ?? "")) names.push(f.name ?? f.fileId);
  }
  return names;
}

// Public entry: serialize runs per workspace so two concurrent runs can't both
// produce a report (a second run is rejected with CONFLICT). The work itself is
// runAnalysisInner.
export async function runAnalysis(
  input: RunAnalysisInput,
): Promise<RunAnalysisResult> {
  return withWorkspaceRunLock(input.workspaceId, () => runAnalysisInner(input));
}

async function runAnalysisInner(
  input: RunAnalysisInput,
): Promise<RunAnalysisResult> {
  const { token, workspaceId, actorId, now, runLabel, window, sections } = input;
  const { reportLength, customPrompt } = input;

  // 1. Gather user-scoped inputs (links, deliverables, live roadmap, baseline).
  const inputs = await getRunInputs(token, workspaceId);

  // 2. Precondition: both Drive folders configured + parseable to a folder id.
  if (!inputs.sourceFolderId || !inputs.outputFolderId) {
    throw new StructuredError(
      "FAILED_PRECONDITION",
      "Both a Source and an Output Drive folder must be configured for this workspace before running an analysis.",
      { hasSource: !!inputs.sourceFolderId, hasOutput: !!inputs.outputFolderId },
    );
  }
  const { sourceFolderId, outputFolderId } = inputs;

  // U3 — remember the chosen report-section combination for this workspace.
  // Saved at run start (not run end) so the choice persists even when the run
  // produces no new report (empty period / no changes). Absent → leave it as-is.
  if (sections) {
    await setWorkspaceReportSections(workspaceId, sections);
  }

  // 0143 — effective report length + custom focus. The panel passes the current
  // values (saved here so they persist + apply to non-panel runs); when absent we
  // fall back to the workspace's saved settings ('medium' / no focus by default).
  const savedSettings = await getWorkspaceReportSettings(workspaceId).catch(() => ({
    reportLength: "medium" as ReportLength,
    customPrompt: null as string | null,
  }));
  if (reportLength !== undefined || customPrompt !== undefined) {
    await setWorkspaceReportSettings(workspaceId, { reportLength, customPrompt });
  }
  const effReportLength = reportLength ?? savedSettings.reportLength;
  const effCustomPrompt =
    customPrompt !== undefined ? customPrompt : savedSettings.customPrompt;

  // 3. Detect (WINDOW mode) → files modified in [start,end]; split added vs
  //    removed (window mode yields no removed — there is no change feed).
  const detected = await detect({
    sourceFolderId,
    pageToken: null,
    deliverableLinks: inputs.deliverableLinks,
    // U12.10 — window scopes to a period; no window → whole document (all files).
    ...(window ? { window } : { allFiles: true }),
  });
  const added = detected.files.filter((f) => f.changeType === "added_or_edited");
  const removed = detected.files.filter((f) => f.changeType === "removed");

  // 3b. Same-range dedup (U12.12). Fingerprint the in-window files; if a prior
  //     SUCCESS run for the EXACT same window already produced a report and the
  //     fingerprint is unchanged, nothing changed → point at that report instead
  //     of regenerating a duplicate (skips analyze + Gemini entirely).
  const windowStart = window?.start ?? null;
  const windowEnd = window?.end ?? null;
  const fingerprint = fingerprintOf(added);
  const prior = await findRunByWindow(workspaceId, windowStart, windowEnd);
  if (prior?.reportWebViewLink && sameFingerprint(prior.fingerprint, fingerprint)) {
    return {
      runId: prior.id,
      status: "already_reported",
      reportFileId: prior.reportFileId ?? null,
      reportWebViewLink: prior.reportWebViewLink,
      counts: (prior.counts as RunAnalysisResult["counts"]) ?? null,
      registered: 0,
      errored: 0,
      removedApplied: 0,
      bootstrapped: detected.bootstrapped,
    };
  }
  // Files changed since the previous report of this same window (for the notice).
  const changedSince = prior ? changedFiles(prior.fingerprint, added) : [];

  // 4. Analyze the editable changes (Flash recap inside). windowed → version
  //    gate bypassed so the chosen period is always (re)reported (U12.9).
  const analysis = await analyze({
    workspaceId,
    outputFolderId,
    files: added,
    windowed: true,
  });

  // 4b. No-change short-circuit (U12.5). Nothing reportable in the window —
  //     every editable file was gated out as unchanged (skipped) and there are
  //     no missed updates or removals — so DON'T synthesise a report Doc.
  //     Record a "no_changes" run (still refreshes the registry projection so
  //     skipped files keep their current version) and return early.
  const reportable =
    analysis.some((r) => r.status === "analyzed" || r.status === "error") ||
    removed.length > 0;
  if (!reportable) {
    // U12.7 — distinguish "nothing in this period at all" (no documents modified
    // in the window — e.g. a future/empty date range) from "documents exist but
    // none changed". Both skip the Doc; the page/notice wording differs.
    const settledStatus =
      added.length === 0 && removed.length === 0 ? "empty_period" : "no_changes";
    const rec = await reconcile({
      workspaceId,
      triggeredBy: actorId,
      detected: added,
      analysis,
      removed,
      report: null,
      runStatus: settledStatus,
      now,
      windowStart,
      windowEnd,
      fingerprint,
    });
    return {
      runId: rec.run.id,
      status: settledStatus,
      reportFileId: null,
      reportWebViewLink: null,
      counts: null,
      registered: rec.registered,
      errored: rec.errored,
      removedApplied: rec.removedApplied,
      bootstrapped: detected.bootstrapped,
      // U12.10 — tell the UI the documents' real range so the user can re-pick.
      availableRange: detected.corpusRange ?? null,
    };
  }

  // 4c. Project context — a distilled, cached brief of the workspace's Context
  //     folder, used as background to ground the synthesis (the cache lives in the
  //     Output folder, keyed by the Context files' version fingerprint, so the
  //     per-run cost stops scaling with Context size). Best-effort: a Drive/Gemini
  //     hiccup must never fail the run, and absent/empty context leaves synthesis
  //     unchanged.
  let context: string | null = null;
  try {
    context = await getProjectBrief({ sourceFolderId, outputFolderId });
  } catch {
    context = null;
  }

  // 4d. Contributor → organization map (per-workspace, maintained by hand in
  //     Settings). Best-effort: a read failure falls back to an empty map, which
  //     yields today's name-based attribution. The org resolution happens inside
  //     synthesize, before any contributor reaches Gemini.
  let contributorOrgs: Awaited<ReturnType<typeof listContributorOrgs>> = [];
  try {
    contributorOrgs = await listContributorOrgs(token, workspaceId);
  } catch {
    contributorOrgs = [];
  }

  // 5. Synthesize — terminal on failure (the report is the whole-run product).
  let report: Awaited<ReturnType<typeof synthesize>> | null = null;
  let runStatus: "success" | "error" = "success";
  try {
    report = await synthesize({
      workspaceId,
      outputFolderId,
      runLabel,
      window,
      fileResults: analysis,
      removed,
      baseline: inputs.baseline,
      live: inputs.live,
      changedSince,
      context: context ?? undefined,
      contributorOrgs,
      workspaceName: inputs.workspaceName,
      // U12.x — surface "history unavailable for N files" in the report when a
      // Drive error blocked the revisions read (set by detect; absent/0 → silent).
      revisionErrorCount: detected.revisionErrorCount,
      // U3 — render only the sections this workspace selected (all on if absent).
      sections,
      // 0143 — synthesis verbosity + the workspace's standing custom focus.
      reportLength: effReportLength,
      customPrompt: effCustomPrompt,
    });
  } catch {
    runStatus = "error";
  }

  // 6. Reconcile — syncs the registry and records the run either way.
  const rec = await reconcile({
    workspaceId,
    triggeredBy: actorId,
    detected: added,
    analysis,
    removed,
    report: report
      ? {
          reportFileId: report.reportFileId,
          reportWebViewLink: report.reportWebViewLink,
          counts: report.counts,
        }
      : null,
    runStatus,
    now,
    windowStart,
    windowEnd,
    fingerprint,
  });

  return {
    runId: rec.run.id,
    status: runStatus,
    reportFileId: report?.reportFileId ?? null,
    reportWebViewLink: report?.reportWebViewLink ?? null,
    counts: report?.counts ?? null,
    registered: rec.registered,
    errored: rec.errored,
    removedApplied: rec.removedApplied,
    bootstrapped: detected.bootstrapped,
    // U12.12 — what changed vs the previous report of this same window (if any).
    changedSince: changedSince.length > 0 ? changedSince : undefined,
  };
}
