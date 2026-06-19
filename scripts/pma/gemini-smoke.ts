// PMA Gemini client smoke check (U1b).
//
// Verifies the @google/genai structured-output client end to end against the
// real GEMINI_API_KEY: one cheap Gemini Flash call that must return JSON
// conforming to a tiny schema. No data is written anywhere; output is printed
// only (not committed).
//
// Run with the project's TS runner (tsx):
//   npx tsx scripts/pma/gemini-smoke.ts
// Requires:
//   - GEMINI_API_KEY (AIza…) in .env.local
//
// `lib/pma/clients/gemini.ts` begins with `import "server-only"`, whose runtime
// module is provided by Next's bundler and does NOT resolve under raw node/tsx.
// The resolve hook below aliases it to Next's shipped no-op stub (same approach
// as drive-smoke.ts) so this server-side script can import the client.

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

  const { Type } = await import("@google/genai");
  const { generateStructured } = await import("@/lib/pma/clients/gemini");

  const schema = {
    type: Type.OBJECT,
    properties: {
      ok: { type: Type.BOOLEAN },
      note: { type: Type.STRING },
    },
    required: ["ok", "note"],
  };

  console.log("\n[GEMINI] gemini-3.5-flash structured call …");
  const out = await generateStructured<{ ok: boolean; note: string }>({
    model: "gemini-3.5-flash",
    systemInstruction: "You are a terse health check. Always set ok=true.",
    prompt: 'Reply with ok=true and a 3-word note confirming you are reachable.',
    responseSchema: schema,
    temperature: 0,
  });

  console.log("  parsed JSON:", JSON.stringify(out));
  if (typeof out.ok !== "boolean" || typeof out.note !== "string") {
    throw new Error("Response did not match the expected {ok, note} shape.");
  }

  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
