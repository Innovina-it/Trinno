// PMA synthesize smoke check (U7).
//
// Runs lib/pma/synthesize.ts end to end against the REAL Gemini Pro model and
// the SA-shared OUTPUT test folder ONLY (never the Source folder): it feeds a
// small but realistic set of inputs — per-file recaps, a missed update, a
// removed file, and an Approved baseline vs a LIVE roadmap that has drifted —
// then makes one real Gemini Pro call and writes the synthesised report as a
// native Google Doc under analyses/. The webViewLink is printed so you can open
// the Doc and read what the assistant concluded.
//
// By default the report Doc is LEFT IN PLACE so you can inspect it. Re-run with
// PMA_SMOKE_CLEANUP=1 to trash it automatically afterwards.
//
// Run with the project's TS runner (tsx):
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/pma-sa.json \
//   PMA_TEST_OUTPUT_FOLDER_ID=1XhMBEasXnniAvO66n6Wxr_iAc7QgUESW \
//   npx tsx scripts/pma/synthesize-smoke.ts
// Requires:
//   - GEMINI_API_KEY (AIza…) in .env.local            (real Gemini Pro call)
//   - .secrets/pma-sa.json + GOOGLE_APPLICATION_CREDENTIALS (defaults below)
//   - PMA_TEST_OUTPUT_FOLDER_ID (env or .env.local)   (the OUTPUT test folder)
//
// `lib/pma/synthesize.ts` (and the modules it imports) begin with
// `import "server-only"`, whose runtime module is provided by Next's bundler and
// does NOT resolve under raw node/tsx. The CJS resolve hook below aliases it to
// Next's shipped no-op stub so this server-side script can import the module —
// exactly what Next does for server contexts. Type-only imports are erased by
// tsx, so they never trigger the guard.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as pathResolve } from "node:path";

import type { AnalyzeFileResult, FileRecap } from "@/lib/pma/analyze";
import type { DetectedFile } from "@/lib/pma/detect";
import type { BaselineDetail, BaselineEntry } from "@/lib/baselines/types";

// ── Sample inputs ────────────────────────────────────────────────────────────

const recap = (over: Partial<FileRecap>): FileRecap => ({
  additions: [],
  edits: [],
  structural_changes: [],
  one_line_summary: "",
  recap: [],
  quality_judgment: "adequate",
  importance: "medium",
  risk_flags: [],
  is_deliverable: false,
  ...over,
});

const analyzed = (fileId: string, r: Partial<FileRecap>): AnalyzeFileResult => ({
  fileId,
  version: "v1",
  status: "analyzed",
  recapFileId: `recap-${fileId}`,
  recap: recap(r),
  error: null,
});

const fileResults: AnalyzeFileResult[] = [
  analyzed("Spec.gdoc", {
    one_line_summary:
      "Scope section rewritten: onboarding moved to a separate milestone and the SSO requirement was dropped.",
    additions: ["New 'Activation metrics' section", "Acceptance criteria for the empty state"],
    edits: ["Tightened the goals paragraph", "Reworded the non-goals"],
    structural_changes: ["Onboarding split into its own milestone"],
    importance: "high",
    is_deliverable: true,
    risk_flags: ["SSO requirement removed without sign-off"],
    quality_judgment: "strong, but the removed SSO line needs a decision record",
  }),
  analyzed("Notes.gdoc", {
    one_line_summary: "Meeting notes added for the 2026-06-05 sync; a few action items captured.",
    additions: ["Action items for billing"],
    edits: ["Fixed two attendee names"],
    importance: "low",
  }),
  // A file that failed to analyse → a "missed update".
  {
    fileId: "Budget.gsheet",
    version: "v3",
    status: "error",
    recapFileId: null,
    recap: null,
    error: "Gemini returned an empty response.",
  },
];

// A file detected as removed this run.
const removed: DetectedFile[] = [
  {
    fileId: "OldPlan.gdoc",
    name: "OldPlan.gdoc",
    mimeType: null,
    modifiedTime: null,
    headRevisionId: null,
    version: null,
    kind: null,
    isDeliverable: false,
    cardLinkId: null,
    changeType: "removed",
  },
];

// Approved baseline vs the LIVE roadmap, drifted so compareToBaseline produces a
// rich, grounded variance: one card slipped, one pulled in, one new, one removed.
const baseEntry = (over: Partial<BaselineEntry> & { cardId: string; title: string }): BaselineEntry => ({
  startDate: null,
  targetDate: null,
  completedAt: null,
  roadmapOrder: null,
  sprintId: null,
  parentCardId: null,
  assignees: [],
  ...over,
});

const baseline: BaselineDetail = {
  meta: {
    id: "baseline-smoke",
    workspaceId: "ws-smoke",
    name: "Q2 Approved Plan",
    note: null,
    createdBy: "user-smoke",
    createdAt: "2026-04-01T00:00:00Z",
    isApproved: true,
  },
  entries: [
    baseEntry({ cardId: "card-onboarding", title: "Ship onboarding", startDate: "2026-05-01T00:00:00Z", targetDate: "2026-06-01T00:00:00Z", roadmapOrder: 1 }),
    baseEntry({ cardId: "card-billing", title: "Billing v2", startDate: "2026-06-01T00:00:00Z", targetDate: "2026-07-01T00:00:00Z", roadmapOrder: 2 }),
    baseEntry({ cardId: "card-reports", title: "Reporting export", startDate: "2026-06-15T00:00:00Z", targetDate: "2026-07-15T00:00:00Z", roadmapOrder: 3 }),
  ],
  milestones: [{ milestoneId: "ms-beta", name: "Public beta", date: "2026-07-01T00:00:00Z" }],
};

const live = {
  entries: [
    // slipped 10 days
    baseEntry({ cardId: "card-onboarding", title: "Ship onboarding", startDate: "2026-05-01T00:00:00Z", targetDate: "2026-06-11T00:00:00Z", roadmapOrder: 1 }),
    // pulled in 11 days
    baseEntry({ cardId: "card-billing", title: "Billing v2", startDate: "2026-06-01T00:00:00Z", targetDate: "2026-06-20T00:00:00Z", roadmapOrder: 2 }),
    // card-reports REMOVED from live (was in baseline)
    // new card not in baseline
    baseEntry({ cardId: "card-hotfix", title: "Hotfix: login loop", startDate: "2026-06-06T00:00:00Z", targetDate: "2026-06-09T00:00:00Z", roadmapOrder: 3 }),
  ],
  // beta milestone moved 14 days later
  milestones: [{ milestoneId: "ms-beta", name: "Public beta", date: "2026-07-15T00:00:00Z" }],
};

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = pathResolve(here, "..", "..");

  // Alias `server-only` → Next's no-op stub for this process only (CJS require).
  const serverOnlyStub = join(
    repoRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "server-only",
    "empty.js",
  );
  const require = createRequire(import.meta.url);
  const Module = require("node:module") as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "server-only") return serverOnlyStub;
    return originalResolve.call(this, request, ...rest);
  };

  // Load env (.env.local) the same way the seed + sibling smoke scripts do.
  const { config } = await import("dotenv");
  config({ path: join(repoRoot, ".env.local") });
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(repoRoot, ".secrets", "pma-sa.json");
  }

  const outputId = process.env.PMA_TEST_OUTPUT_FOLDER_ID;
  if (!outputId) {
    throw new Error("Missing PMA_TEST_OUTPUT_FOLDER_ID. Set it in the environment or .env.local.");
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY (AIza…). Add it to .env.local — this smoke makes a REAL Gemini Pro call.");
  }

  const { synthesize } = await import("@/lib/pma/synthesize");
  const { trashFile } = await import("@/lib/pma/clients/drive");

  const runLabel = new Date()
    .toLocaleString("en-GB", { timeZone: "Europe/Rome", hour12: false })
    .replace(",", "") + " (UTC+1)";

  console.log(`\n[synthesize] OUTPUT folder ${outputId}`);
  console.log(`[synthesize] runLabel = ${runLabel}`);
  console.log(`[synthesize] inputs: ${fileResults.filter((r) => r.status === "analyzed").length} analyzed, ` +
    `${fileResults.filter((r) => r.status === "error").length} missed, ${removed.length} removed, baseline=Approved`);
  console.log(`[synthesize] calling Gemini Pro (gemini-2.5-pro) — this can take 10-30s...\n`);

  const res = await synthesize({
    workspaceId: "ws-smoke",
    outputFolderId: outputId,
    runLabel,
    fileResults,
    removed,
    baseline,
    live,
  });

  console.log("── STRUCTURED REPORT (from Gemini Pro) ──────────────────────────");
  console.log(JSON.stringify(res.report, null, 2));
  console.log("\n── COUNTS ───────────────────────────────────────────────────────");
  console.log(JSON.stringify(res.counts));
  console.log("\n── GOOGLE DOC ───────────────────────────────────────────────────");
  console.log(`  reportFileId    = ${res.reportFileId}`);
  console.log(`  >>> OPEN THIS:    ${res.reportWebViewLink}`);

  if (process.env.PMA_SMOKE_CLEANUP === "1") {
    console.log(`\n[cleanup] PMA_SMOKE_CLEANUP=1 → trashing report Doc ${res.reportFileId}`);
    await trashFile(res.reportFileId);
    console.log("  trashed.");
  } else {
    console.log(`\n[note] report Doc left in place for inspection.`);
    console.log(`       re-run with PMA_SMOKE_CLEANUP=1 to auto-trash it, or delete it from Drive.`);
  }

  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
