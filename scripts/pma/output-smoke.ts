// PMA Drive OUTPUT helpers smoke check (U4b).
//
// Verifies lib/pma/output.ts end to end against the SA-shared OUTPUT test
// folder ONLY. NEVER writes to the Source folder — the only write target is
// PMA_TEST_OUTPUT_FOLDER_ID.
//
// What it proves:
//   1. ensureSubfolder("recaps") + ensureSubfolder("analyses") create the
//      sub-folders, AND are IDEMPOTENT — a second call returns the SAME folder
//      id and does NOT create a duplicate (asserted, and re-verified by
//      counting matching children before/after).
//   2. writeRecap writes recaps/{sourceFileId}__{version}.json.
//   3. createReport creates a Google Doc under analyses/ (prints webViewLink).
//   4. listOutput shows the recaps/ + analyses/ sub-folders, and listing each
//      sub-folder shows the recap file + report Doc.
//   5. Cleanup: the temp recap file + report Doc are trashed. The recaps/ and
//      analyses/ sub-folders are left in place (idempotency makes that safe).
//
// Run with the project's TS runner (tsx):
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/pma-sa.json \
//   PMA_TEST_OUTPUT_FOLDER_ID=<output-folder-id> \
//   npx tsx scripts/pma/output-smoke.ts
// Requires:
//   - .secrets/pma-sa.json present and GOOGLE_APPLICATION_CREDENTIALS pointing
//     at it (defaults to .secrets/pma-sa.json below if unset).
//   - PMA_TEST_OUTPUT_FOLDER_ID (env or .env.local).
//
// `lib/pma/output.ts` (and the client it imports) begin with
// `import "server-only"`, whose runtime module is provided by Next's bundler
// and does NOT resolve under raw node/tsx. The resolve hook registered below
// aliases it to Next's shipped no-op stub so this server-side script can import
// the module — exactly what Next does for server contexts. It changes nothing
// about the build.
//
// Everything runs inside an async main() so failures surface as one clean
// "SMOKE FAILED: <reason>" line with a non-zero exit.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as pathResolve } from "node:path";

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = pathResolve(here, "..", "..");

  // Alias `server-only` → Next's no-op stub for this process only. tsx loads
  // the imported module through CommonJS `require`, so we patch CJS resolution
  // (ESM `module.register` hooks would not cover the require path).
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

  // Load env (.env.local) the same way the seed scripts do.
  const { config } = await import("dotenv");
  config({ path: join(repoRoot, ".env.local") });
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(
      repoRoot,
      ".secrets",
      "pma-sa.json",
    );
  }

  const outputId = process.env.PMA_TEST_OUTPUT_FOLDER_ID;
  if (!outputId) {
    throw new Error(
      "Missing PMA_TEST_OUTPUT_FOLDER_ID. Set it in the environment or .env.local.",
    );
  }

  const out = await import("@/lib/pma/output");

  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const countNamed = (entries: { name: string; mimeType: string }[], name: string) =>
    entries.filter((e) => e.name === name && e.mimeType === FOLDER_MIME).length;

  // ---- 1. ensureSubfolder idempotency (recaps/ + analyses/) ----------------
  console.log(`\n[OUTPUT] folder ${outputId}`);

  console.log(`[ensureSubfolder] recaps/ — 1st call`);
  const recaps1 = await out.ensureSubfolder(outputId, "recaps");
  console.log(`  → ${recaps1}`);
  console.log(`[ensureSubfolder] recaps/ — 2nd call (must be SAME id)`);
  const recaps2 = await out.ensureSubfolder(outputId, "recaps");
  console.log(`  → ${recaps2}`);
  if (recaps1 !== recaps2) {
    throw new Error(
      `ensureSubfolder("recaps") NOT idempotent: ${recaps1} !== ${recaps2}`,
    );
  }

  console.log(`[ensureSubfolder] analyses/ — 1st call`);
  const analyses1 = await out.ensureSubfolder(outputId, "analyses");
  console.log(`  → ${analyses1}`);
  console.log(`[ensureSubfolder] analyses/ — 2nd call (must be SAME id)`);
  const analyses2 = await out.ensureSubfolder(outputId, "analyses");
  console.log(`  → ${analyses2}`);
  if (analyses1 !== analyses2) {
    throw new Error(
      `ensureSubfolder("analyses") NOT idempotent: ${analyses1} !== ${analyses2}`,
    );
  }

  // Re-verify at the Drive level: exactly ONE recaps/ and ONE analyses/ child.
  const topAfterEnsure = await out.listOutput(outputId);
  const recapsCount = countNamed(topAfterEnsure, "recaps");
  const analysesCount = countNamed(topAfterEnsure, "analyses");
  console.log(
    `[idempotency check] children named recaps=${recapsCount} analyses=${analysesCount} (each must be exactly 1)`,
  );
  if (recapsCount !== 1 || analysesCount !== 1) {
    throw new Error(
      `Duplicate sub-folder(s) created: recaps=${recapsCount} analyses=${analysesCount}`,
    );
  }

  // ---- 2. writeRecap -------------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sourceFileId = `smoke-src-${stamp}`;
  const version = "v1";
  console.log(
    `\n[writeRecap] recaps/${sourceFileId}__${version}.json`,
  );
  const recap = await out.writeRecap(outputId, sourceFileId, version, {
    one_line_summary: "PMA output smoke recap. Safe to delete.",
    at: new Date().toISOString(),
  });
  console.log(`  created recap id=${recap.id}`);

  // ---- 3. createReport -----------------------------------------------------
  const reportName = `pma-output-smoke-report-${stamp}`;
  console.log(`\n[createReport] analyses/${reportName} (Google Doc)`);
  const report = await out.createReport(outputId, {
    name: reportName,
    content: `PMA output smoke report at ${new Date().toISOString()}. Safe to delete.`,
  });
  console.log(`  created report id=${report.id}`);
  console.log(`  webViewLink=${report.webViewLink}`);

  // ---- 4. listOutput confirms the artifacts appear -------------------------
  console.log(`\n[listOutput] recaps/ (${recaps1})`);
  const recapsList = await out.listOutput(recaps1);
  for (const e of recapsList) console.log(`  - ${e.id}  ${e.name}  ${e.mimeType}`);
  if (!recapsList.some((e) => e.id === recap.id)) {
    throw new Error("writeRecap file not found in recaps/ listing.");
  }

  console.log(`[listOutput] analyses/ (${analyses1})`);
  const analysesList = await out.listOutput(analyses1);
  for (const e of analysesList) console.log(`  - ${e.id}  ${e.name}  ${e.mimeType}`);
  if (!analysesList.some((e) => e.id === report.id)) {
    throw new Error("createReport Doc not found in analyses/ listing.");
  }

  // ---- 5. Cleanup: trash the temp recap file + report Doc ------------------
  // Leave recaps/ + analyses/ sub-folders in place — idempotency makes reuse
  // safe and matches how the real pipeline behaves.
  console.log(`\n[cleanup] trashing temp recap ${recap.id}`);
  await out.trashFile(recap.id);
  console.log(`[cleanup] trashing temp report Doc ${report.id}`);
  await out.trashFile(report.id);
  console.log("  trashed.");

  console.log("\nSMOKE OK");
  console.log(
    `  recaps/ folder id   = ${recaps1}\n` +
      `  analyses/ folder id = ${analyses1}\n` +
      `  report webViewLink  = ${report.webViewLink}`,
  );
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
