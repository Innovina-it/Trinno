// PMA Drive client smoke check (U1a).
//
// Verifies the service-account Drive client end to end against the two
// SA-shared TEST folders:
//   (a) READ  — lists the Source test folder, printing id/name/modifiedTime/
//               headRevisionId for each file.
//   (b) WRITE — creates a temp Google Doc in the Output test folder, prints its
//               webViewLink, then trashes it.
//
// NEVER writes to the Source folder. The only write target is
// PMA_TEST_OUTPUT_FOLDER_ID.
//
// Run with the project's TS runner (tsx):
//   npx tsx scripts/pma/drive-smoke.ts
// Requires:
//   - .secrets/pma-sa.json present and GOOGLE_APPLICATION_CREDENTIALS pointing
//     at it (defaults to .secrets/pma-sa.json below if unset).
//   - PMA_TEST_SOURCE_FOLDER_ID / PMA_TEST_OUTPUT_FOLDER_ID in .env.local
//     (see .env.local.example for the test-fixture IDs).
//
// `lib/pma/clients/drive.ts` begins with `import "server-only"`, whose runtime
// module (`server-only`) is provided by Next's bundler and does NOT resolve
// under raw node/tsx. The resolve hook registered below aliases it to Next's
// shipped no-op stub so this server-side script can import the client — exactly
// what Next does for server contexts. It changes nothing about the build.
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
  // the imported client through CommonJS `require`, so we patch CJS resolution
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
    _resolveFilename: (
      request: string,
      ...rest: unknown[]
    ) => string;
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
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(repoRoot, ".secrets", "pma-sa.json");
  }

  const sourceId = process.env.PMA_TEST_SOURCE_FOLDER_ID;
  const outputId = process.env.PMA_TEST_OUTPUT_FOLDER_ID;
  if (!sourceId || !outputId) {
    throw new Error(
      "Missing PMA_TEST_SOURCE_FOLDER_ID / PMA_TEST_OUTPUT_FOLDER_ID. " +
        "Copy them from .env.local.example into .env.local.",
    );
  }

  const drive = await import("@/lib/pma/clients/drive");

  // (a) READ the Source folder — read-only, never written to.
  console.log(`\n[READ] Source folder ${sourceId}`);
  const files = await drive.listFolder(sourceId);
  if (files.length === 0) {
    console.log("  (folder is empty or nothing shared to the SA)");
  }
  for (const f of files) {
    console.log(
      `  - ${f.id}  ${f.name}  modified=${f.modifiedTime}  headRevisionId=${f.headRevisionId ?? "—"}`,
    );
  }

  // Show the Changes-API bootstrap token works too (read-only).
  const startToken = await drive.getStartPageToken();
  console.log(`[READ] changes.getStartPageToken → ${startToken}`);

  // (b) WRITE to the Output folder ONLY — create then trash a temp Doc.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `pma-smoke-${stamp}`;
  console.log(`\n[WRITE] creating temp Google Doc "${name}" in Output folder ${outputId}`);
  const doc = await drive.createDoc({
    name,
    parentId: outputId,
    content: `PMA Drive smoke check at ${new Date().toISOString()}. Safe to delete.`,
  });
  console.log(`  created id=${doc.id}`);
  console.log(`  webViewLink=${doc.webViewLink}`);

  console.log(`[WRITE] trashing temp Doc ${doc.id}`);
  await drive.trashFile(doc.id);
  console.log("  trashed.");

  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
