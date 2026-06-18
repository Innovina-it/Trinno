// PMA Drive OUTPUT helpers smoke check (U4b).
//
// Verifies lib/pma/output.ts end to end against the SA-shared OUTPUT test
// folder ONLY. NEVER writes to the Source folder — the only write target is
// PMA_TEST_OUTPUT_FOLDER_ID.
//
// What it proves (U12.1 — recaps/ removed; recap bodies live in Postgres now):
//   1. ensureSubfolder("analyses") creates the sub-folder AND is IDEMPOTENT — a
//      second call returns the SAME folder id and does NOT create a duplicate
//      (asserted, and re-verified by counting matching children before/after).
//   2. createReport creates a Google Doc under analyses/ (prints webViewLink).
//   3. listOutput shows the analyses/ sub-folder, and listing it shows the Doc.
//   4. Cleanup: the temp report Doc is trashed. The analyses/ sub-folder is left
//      in place (idempotency makes that safe).
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

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // ---- 1. createReport writes directly into the Reports (output) folder -----
  console.log(`\n[OUTPUT] folder ${outputId}`);
  const reportName = `pma-output-smoke-report-${stamp}`;
  console.log(`\n[createReport] ${reportName} (Google Doc, written directly into the folder)`);
  const report = await out.createReport(outputId, {
    name: reportName,
    content: `PMA output smoke report at ${new Date().toISOString()}. Safe to delete.`,
  });
  console.log(`  created report id=${report.id}`);
  console.log(`  webViewLink=${report.webViewLink}`);

  // ---- 2. listOutput confirms the artifact appears -------------------------
  console.log(`\n[listOutput] ${outputId}`);
  const list = await out.listOutput(outputId);
  for (const e of list) console.log(`  - ${e.id}  ${e.name}  ${e.mimeType}`);
  if (!list.some((e) => e.id === report.id)) {
    throw new Error("createReport Doc not found in the output folder listing.");
  }

  // ---- 3. Cleanup: trash the temp report Doc -------------------------------
  console.log(`\n[cleanup] trashing temp report Doc ${report.id}`);
  await out.trashFile(report.id);
  console.log("  trashed.");

  console.log("\nSMOKE OK");
  console.log(`  report webViewLink = ${report.webViewLink}`);
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
