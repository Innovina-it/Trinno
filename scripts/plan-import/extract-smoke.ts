// Smoke test for the plan extractor. Runs the real Gemini call against a real
// bando PDF and prints the structured plan. Not in CI (needs GEMINI_API_KEY).
//
// Usage:
//   GEMINI_API_KEY=… npx tsx scripts/plan-import/extract-smoke.ts path/to/bando.pdf
import { readFile } from "node:fs/promises";
import { extractPlanFromPdf } from "@/lib/plan-import/extract";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: extract-smoke.ts <pdf-path>");
  const bytes = await readFile(path);
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
