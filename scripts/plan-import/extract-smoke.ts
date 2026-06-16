// Smoke test for the plan extractor. Runs the real Gemini call against a real
// bando PDF and prints the structured plan. Not in CI (needs GEMINI_API_KEY).
//
// Usage:
//   npx tsx scripts/plan-import/extract-smoke.ts "path/to/bando.pdf"
// Requires GEMINI_API_KEY (AIza…) in .env.local.
//
// `lib/plan-import/extract.ts` begins with `import "server-only"`, whose runtime
// module is provided by Next's bundler and does NOT resolve under raw node/tsx.
// The resolve hook below aliases it to Next's shipped no-op stub (same approach
// as scripts/pma/*-smoke.ts) so this server-side script can import the extractor.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as pathResolve } from "node:path";

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = pathResolve(here, "..", "..");

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

  const { config } = await import("dotenv");
  config({ path: join(repoRoot, ".env.local") });
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env.local (AIza… key from aistudio.google.com).");
  }

  const path = process.argv[2];
  if (!path) throw new Error('usage: extract-smoke.ts "<pdf-path>"');

  const { extractPlanFromPdf } = await import("@/lib/plan-import/extract");
  const bytes = await readFile(path);
  console.log(`[extract] ${(bytes.length / 1024).toFixed(0)} KB → gemini-3.5-flash …`);
  const plan = await extractPlanFromPdf(bytes);

  console.log(JSON.stringify(plan, null, 2));
  const tasks = plan.workPackages.reduce((n, w) => n + w.tasks.length, 0);
  const dels = plan.workPackages.reduce((n, w) => n + w.deliverables.length, 0);
  console.log(
    `\n${plan.workPackages.length} WP · ${tasks} tasks · ${dels} deliverables · ${plan.milestones.length} milestones`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
