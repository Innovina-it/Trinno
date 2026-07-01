import type { PmaAnalysisRunRow, RunProgress } from "@/lib/db/schema";

// PMA 0145 (run manager) — the serialized run shape the Analysis client renders
// and the shared staleness threshold. Pure (no secrets, no DB), so both server
// routes and the client workbench can import it.

// A 'running' row whose heartbeat is older than this is treated as dead (its
// function was killed) and reaped to 'error'. Set beyond the 300s function cap
// so a still-alive run is never falsely reaped — the longest gap between
// heartbeats is the single synthesis call, comfortably under this.
export const STALE_RUN_MS = 6 * 60 * 1000;

export type RunSettingsSnapshot = {
  sections: Record<string, boolean> | null;
  length: string | null;
  customPrompt: string | null;
} | null;

// The run row shape the Analysis client renders (dates → ISO strings, plus the
// 0145 live fields for an in-flight row).
export type RunSummary = {
  id: string;
  runAt: string | null;
  status: string | null;
  counts: Record<string, number> | null;
  reportWebViewLink: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  settings: RunSettingsSnapshot;
  progress: RunProgress | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  cancelRequested: boolean;
};

const iso = (v: string | Date | null | undefined): string | null =>
  v == null
    ? null
    : typeof v === "string"
      ? new Date(v).toISOString()
      : v.toISOString();

export function serializeRun(r: PmaAnalysisRunRow): RunSummary {
  return {
    id: r.id,
    runAt: iso(r.runAt),
    status: r.status ?? null,
    counts: (r.counts as Record<string, number> | null) ?? null,
    reportWebViewLink: r.reportWebViewLink ?? null,
    windowStart: iso(r.windowStart),
    windowEnd: iso(r.windowEnd),
    settings: (r.settings as RunSummary["settings"]) ?? null,
    progress: (r.progress as RunProgress | null) ?? null,
    startedAt: iso(r.startedAt),
    heartbeatAt: iso(r.heartbeatAt),
    cancelRequested: r.cancelRequested ?? false,
  };
}
