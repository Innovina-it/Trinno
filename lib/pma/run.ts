import "server-only";

import { StructuredError } from "@/lib/errors/structured-error";
import { detect } from "./detect";
import { analyze } from "./analyze";
import { synthesize } from "./synthesize";
import { reconcile } from "./reconcile";
import { getRunInputs } from "./inputs";

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
  window: { start: string; end: string };
};

export type RunAnalysisResult = {
  runId: string;
  status: "success" | "error";
  reportFileId: string | null;
  reportWebViewLink: string | null;
  counts: { changed: number; missed: number; removed: number } | null;
  registered: number;
  errored: number;
  removedApplied: number;
  bootstrapped: boolean;
};

export async function runAnalysis(
  input: RunAnalysisInput,
): Promise<RunAnalysisResult> {
  const { token, workspaceId, actorId, now, runLabel, window } = input;

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

  // 3. Detect (WINDOW mode) → files modified in [start,end]; split added vs
  //    removed (window mode yields no removed — there is no change feed).
  const detected = await detect({
    sourceFolderId,
    pageToken: null,
    deliverableLinks: inputs.deliverableLinks,
    window,
  });
  const added = detected.files.filter((f) => f.changeType === "added_or_edited");
  const removed = detected.files.filter((f) => f.changeType === "removed");

  // 4. Analyze the editable changes (version gate + Flash recap inside).
  const analysis = await analyze({ workspaceId, outputFolderId, files: added });

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
  };
}
