import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRON_API_PATHS_EXACT } from "@/lib/supabase/middleware";

// Tripwire: any route handler doing in-handler Bearer / x-cron-key auth must
// either live under /api/cron/ OR be listed in CRON_API_PATHS_EXACT. Drift
// here makes the handler's auth dead code — middleware 401s the request
// before the secret check runs (see commit history: this exact gap broke
// /api/sla/scan and /api/notifications/digest in prod).

const SECRET_PATTERNS = /CRON_SECRET|CRON_KEY|x-cron-key/;

function routeFileToPath(file: string, repoRoot: string): string {
  const rel = file.startsWith(repoRoot)
    ? file.slice(repoRoot.length).replace(/^\/+/, "")
    : file;
  return (
    "/" +
    rel
      .replace(/^app\//, "")
      .replace(/\/route\.tsx?$/, "")
      // strip Next route groups: (group)
      .replace(/\/\([^/]+\)/g, "")
  );
}

describe("cron route allowlist", () => {
  it("every CRON-secret route is reachable through middleware", () => {
    const repoRoot = resolve(__dirname, "../..");
    const raw = execSync(
      `grep -rl --include="route.ts" --include="route.tsx" -E "CRON_SECRET|CRON_KEY|x-cron-key" "${repoRoot}/app" 2>/dev/null || true`,
    )
      .toString()
      .trim();

    if (!raw) return;

    const offenders: string[] = [];
    for (const file of raw.split("\n").filter(Boolean)) {
      const contents = readFileSync(file, "utf8");
      if (!SECRET_PATTERNS.test(contents)) continue;
      const path = routeFileToPath(file, repoRoot);
      const allowed =
        path.startsWith("/api/cron/") || CRON_API_PATHS_EXACT.has(path);
      if (!allowed) offenders.push(`${path}  (${file})`);
    }

    expect(
      offenders,
      `cron-style routes blocked by middleware (add to CRON_API_PATHS_EXACT or move under /api/cron/):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
