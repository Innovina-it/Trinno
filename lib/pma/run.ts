import "server-only";

import { StructuredError } from "@/lib/errors/structured-error";
import { detect } from "./detect";
import { analyze } from "./analyze";
import { synthesize } from "./synthesize";
import { reconcile } from "./reconcile";
import { getWorkspacePageToken, setWorkspacePageToken } from "./registry";
import { getRunInputs } from "./inputs";

// PMA U9 — RUN ORCHESTRATION (DESIGN §3, the A→G pipeline).
//
// Wires the whole "Run analysis" behind the route's owner/admin gate:
//   inputs → precondition → load checkpoint → A detect → D analyze →
//   E synthesize (terminal on failure) → G reconcile → persist checkpoint.
//
// Service-role vs user: getRunInputs reads OUR Postgres as the acting user
// (RLS). detect/analyze/synthesize touch Drive + Gemini and reconcile/registry
// write service-role — all server-only, no client exposure.
//
// CHECKPOINT POLICY: the Drive changes page token is advanced ONLY on a fully
// successful run, so a failed synthesis re-detects the same change set next
// time. (A retry's report completeness for files already reconciled in the
// failed run is a U11 follow-up — synthesize would currently see them as
// version-gate skips with no in-memory recap.)

export type RunAnalysisInput = {
  token: string;
  workspaceId: string;
  actorId: string;
  now: string; // ISO timestamp (run clock)
  runLabel: string; // display label (UTC+1) for the report Doc
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
  const { token, workspaceId, actorId, now, runLabel } = input;

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

  // 3. Load the incremental checkpoint (null → detect bootstraps).
  const pageToken = await getWorkspacePageToken(workspaceId);

  // 4. Detect → split added/edited vs removed.
  const detected = await detect({
    sourceFolderId,
    pageToken,
    deliverableLinks: inputs.deliverableLinks,
  });
  const added = detected.files.filter((f) => f.changeType === "added_or_edited");
  const removed = detected.files.filter((f) => f.changeType === "removed");

  // 5. Analyze the editable changes (version gate + Flash recap inside).
  const analysis = await analyze({ workspaceId, outputFolderId, files: added });

  // 6. Synthesize — terminal on failure (the report is the whole-run product).
  let report: Awaited<ReturnType<typeof synthesize>> | null = null;
  let runStatus: "success" | "error" = "success";
  try {
    report = await synthesize({
      workspaceId,
      outputFolderId,
      runLabel,
      fileResults: analysis,
      removed,
      baseline: inputs.baseline,
      live: inputs.live,
    });
  } catch {
    runStatus = "error";
  }

  // 7. Reconcile — syncs the registry and records the run either way.
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

  // 8. Advance the checkpoint only on success.
  if (runStatus === "success") {
    await setWorkspacePageToken(workspaceId, detected.newPageToken);
  }

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
