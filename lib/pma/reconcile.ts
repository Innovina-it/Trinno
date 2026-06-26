import "server-only";

import {
  listRegistry,
  recordRun,
  upsertRegistryEntry,
} from "./registry";
import type { RegistryUpsert } from "./registry";
import type { PmaAnalysisRunRow } from "@/lib/db/schema";
import type { AnalyzeFileResult } from "./analyze";
import type { DetectedFile } from "./detect";

// PMA U8 — RECONCILE (DESIGN §3 step G).
//
// The final step of a run: sync the Postgres registry (the rebuildable Drive
// projection — keys/kind/pointers only) from this run's detect + analyze +
// removed outputs, then record the run in pma_analysis_runs for the Analysis
// tab. No bulk content is written — recap/report TEXT stays in Drive.
//
// STATE RULES (DESIGN §4.3):
//  - analyzed  → state=active, ADVANCE last_version to the analysed version,
//                stamp last_analyzed_at, store the structured recap in recap_json
//                (U12.1 — was a recaps/ Drive file pointed at by recap_file_id).
//  - skipped   → state=active, last_version unchanged (already current); just
//                refresh the metadata projection.
//  - non_mod   → state=active, metadata only (no recap, no Gemini); still
//                tracked so deletion/orphan detection works.
//  - error     → state=error, last_version is LEFT UNTOUCHED so the next run
//                re-detects the same version and retries (a "missed update").
//  - removed   → state=removed, but ONLY for ids that already exist in the
//                registry as source files. detect()'s removed list is
//                drive-wide/best-effort; intersecting against the registry
//                drops Output-folder churn and other out-of-scope ids (the
//                scoping detect() explicitly defers here).
//
// CASING: depends on the registry layer now returning camelCase rows
// (registry.mapRegistryRow) so the removed-id intersection can read
// `row.sourceFileId`. That was the U6-flagged fix, landed in this unit.

export type ReconcileInput = {
  workspaceId: string;
  triggeredBy: string | null;
  // Current source-folder files this run (detect output, changeType
  // "added_or_edited" — editable AND non_mod). Carries the metadata projection.
  detected: DetectedFile[];
  // Per-editable-file outcomes from analyze() (status + version + recap pointer).
  analysis: AnalyzeFileResult[];
  // Files detected as removed this run (changeType "removed").
  removed: DetectedFile[];
  // synthesize() result, or null when synthesis failed (run still recorded).
  report: {
    reportFileId: string;
    reportWebViewLink: string;
    counts: { changed: number; missed: number; removed: number; deliverables?: number };
  } | null;
  // U12.5/U12.7 — "no_changes" (files unchanged) and "empty_period" (no docs in
  // the window) are recorded for runs that produce no report Doc. The
  // version-advance branch keys off `=== "success"`, so neither advances
  // last_version (and such runs have no analyzed files anyway).
  runStatus: "success" | "error" | "no_changes" | "empty_period";
  // ISO timestamp for last_analyzed_at / run_at. Passed in for determinism
  // (mirrors synthesize.runLabel) — the orchestrator stamps the run clock.
  now: string;
  // U12.12 — the run's date window (null = whole-document) + content fingerprint,
  // recorded on the run row for same-range dedup.
  windowStart?: string | null;
  windowEnd?: string | null;
  fingerprint?: Record<string, string> | null;
};

export type ReconcileResult = {
  registered: number; // active rows upserted (analyzed + skipped + non_mod)
  errored: number; // rows marked state=error
  removedApplied: number; // removed rows actually applied (intersected)
  run: PmaAnalysisRunRow;
};

export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  // Analysis outcome by fileId (editable files only; non_mod never reach here).
  const outcomeById = new Map<string, AnalyzeFileResult>();
  for (const r of input.analysis) outcomeById.set(r.fileId, r);

  let registered = 0;
  let errored = 0;

  // ── Active / error projection for every current source file ────────────────
  for (const file of input.detected) {
    const outcome = outcomeById.get(file.fileId);
    const base: RegistryUpsert = {
      workspaceId: input.workspaceId,
      sourceFileId: file.fileId,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind ?? undefined,
      isDeliverable: file.isDeliverable,
      cardLinkId: file.cardLinkId,
    };

    if (outcome?.status === "error") {
      // Keep last_version untouched (omit it) so the file retries next run.
      await upsertRegistryEntry({ ...base, state: "error" });
      errored += 1;
      continue;
    }

    if (outcome?.status === "analyzed") {
      // Advance the gate ONLY when the run as a whole succeeded. If synthesis
      // failed, leave last_version untouched (like an error) so this file is
      // re-detected AND re-analyzed on the retry — otherwise the gate would
      // skip it next run and the retry's report would omit it (its recap is
      // not in memory). The registry only ever reflects a successful report.
      await upsertRegistryEntry(
        input.runStatus === "success"
          ? {
              ...base,
              state: "active",
              lastVersion: outcome.version ?? file.version,
              lastAnalyzedAt: input.now,
              // U12.1 — persist the recap body in Postgres (was a Drive pointer).
              recapJson: outcome.recap,
            }
          : { ...base, state: "active" },
      );
    } else {
      // skipped (unchanged editable) or non_mod (metadata only): record the
      // current version as the gate checkpoint, no recap change.
      await upsertRegistryEntry({
        ...base,
        state: "active",
        lastVersion: file.version,
      });
    }
    registered += 1;
  }

  // ── Removed projection — intersect against the registry (source files only) ─
  let removedApplied = 0;
  if (input.removed.length > 0) {
    const known = new Set(
      (await listRegistry(input.workspaceId)).map((r) => r.sourceFileId),
    );
    for (const file of input.removed) {
      if (!known.has(file.fileId)) continue; // phantom / out-of-scope id
      await upsertRegistryEntry({
        workspaceId: input.workspaceId,
        sourceFileId: file.fileId,
        state: "removed",
      });
      removedApplied += 1;
    }
  }

  // ── Record the run for the Analysis tab (DESIGN §4.4) ──────────────────────
  const run = await recordRun({
    workspaceId: input.workspaceId,
    triggeredBy: input.triggeredBy,
    status: input.runStatus,
    counts: input.report?.counts ?? null,
    reportFileId: input.report?.reportFileId ?? null,
    reportWebViewLink: input.report?.reportWebViewLink ?? null,
    runAt: input.now,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    fingerprint: input.fingerprint ?? null,
  });

  return { registered, errored, removedApplied, run };
}
