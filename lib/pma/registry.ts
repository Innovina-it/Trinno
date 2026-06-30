import "server-only";

import { getServiceSupabase } from "@/lib/supabase/service-role";
import type {
  PmaFileRegistryRow,
  PmaAnalysisRunRow,
} from "@/lib/db/schema";
import {
  sanitizeReportSections,
  type ReportSections,
} from "./report-sections";
import {
  sanitizeReportLength,
  sanitizeCustomPrompt,
  type ReportLength,
} from "./report-settings";

// PMA Postgres data layer — registry CRUD + run-index (DESIGN §4.3, §4.4).
// KEYS / KIND / POINTERS ONLY — NO bulk content: recap and report TEXT live in
// the Drive OUTPUT folder (the system of record). These helpers maintain the
// rebuildable Postgres projection of Drive.
//
// SERVICE-ROLE ONLY. The registry is server-managed: the run orchestrator
// syncs it outside any user session, so writes bypass RLS via the service-role
// Supabase client (mirrors notification_deliveries / lib/notifications/dispatch
// — both service-role-write tables with member-only SELECT policies). The
// `import "server-only"` guard makes this module throw if pulled into a client
// bundle. Never expose to the browser.

// ── snake_case → camelCase row mappers ───────────────────────────────────────
// supabase-js returns RAW database columns (snake_case), but the drizzle
// $inferSelect row types are camelCase. The original code cast straight through
// (`as unknown as PmaFileRegistryRow`), which left the runtime object in
// snake_case while the type claimed camelCase — the casing lie U6 flagged. These
// pure mappers make the returned objects actually match their types, so callers
// (analyze's version gate, reconcile's removed-id intersection, U9/U10) can read
// `row.sourceFileId` / `row.lastVersion` and get a value. (Timestamps remain
// ISO strings at runtime — a pre-existing repo-wide supabase-js quirk, out of
// scope here; the final cast preserves the inferred type.)

export function mapRegistryRow(raw: Record<string, unknown>): PmaFileRegistryRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    sourceFileId: raw.source_file_id,
    name: raw.name ?? null,
    parentFolderId: raw.parent_folder_id ?? null,
    mimeType: raw.mime_type ?? null,
    kind: raw.kind ?? null,
    isDeliverable: raw.is_deliverable ?? false,
    cardLinkId: raw.card_link_id ?? null,
    lastVersion: raw.last_version ?? null,
    lastAnalyzedAt: raw.last_analyzed_at ?? null,
    state: raw.state,
    recapFileId: raw.recap_file_id ?? null,
    recapJson: raw.recap_json ?? null,
    updatedAt: raw.updated_at,
  } as unknown as PmaFileRegistryRow;
}

export function mapRunRow(raw: Record<string, unknown>): PmaAnalysisRunRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    runAt: raw.run_at,
    triggeredBy: raw.triggered_by ?? null,
    status: raw.status ?? null,
    counts: raw.counts ?? null,
    reportFileId: raw.report_file_id ?? null,
    reportWebViewLink: raw.report_web_view_link ?? null,
    windowStart: raw.window_start ?? null,
    windowEnd: raw.window_end ?? null,
    fingerprint: raw.fingerprint ?? null,
    settings: raw.settings ?? null,
  } as unknown as PmaAnalysisRunRow;
}

// ── pma_file_registry ────────────────────────────────────────────────────────

export type RegistryKind = "editable" | "non_mod";
export type RegistryState = "active" | "removed" | "error";

// The mutable projection fields for one source file. Keys/kind/pointers only —
// no recap/report content. `workspaceId` + `sourceFileId` are the natural key
// (UNIQUE (workspace_id, source_file_id)); the rest are upserted on conflict.
export type RegistryUpsert = {
  workspaceId: string;
  sourceFileId: string;
  name?: string | null;
  parentFolderId?: string | null;
  mimeType?: string | null;
  kind?: RegistryKind | null;
  isDeliverable?: boolean;
  cardLinkId?: string | null;
  lastVersion?: string | null;
  lastAnalyzedAt?: string | null; // ISO timestamp
  state?: RegistryState;
  recapFileId?: string | null;
  // U12.1 — structured recap body persisted in Postgres (was a Drive file).
  recapJson?: unknown | null;
};

// Upsert one registry row keyed (workspace_id, source_file_id). onConflict keeps
// the run idempotent — re-syncing the same file overwrites its projection in
// place. `updated_at` is refreshed on every write. Only the columns present on
// `entry` are sent; absent optional fields are left to the DB default (insert)
// or untouched is NOT relied upon (upsert replaces — callers pass the full
// desired projection, as the run sync does). Returns the persisted row.
export async function upsertRegistryEntry(
  entry: RegistryUpsert,
): Promise<PmaFileRegistryRow> {
  const sb = getServiceSupabase();
  const row: Record<string, unknown> = {
    workspace_id: entry.workspaceId,
    source_file_id: entry.sourceFileId,
    updated_at: new Date().toISOString(),
  };
  if (entry.name !== undefined) row.name = entry.name;
  if (entry.parentFolderId !== undefined)
    row.parent_folder_id = entry.parentFolderId;
  if (entry.mimeType !== undefined) row.mime_type = entry.mimeType;
  if (entry.kind !== undefined) row.kind = entry.kind;
  if (entry.isDeliverable !== undefined)
    row.is_deliverable = entry.isDeliverable;
  if (entry.cardLinkId !== undefined) row.card_link_id = entry.cardLinkId;
  if (entry.lastVersion !== undefined) row.last_version = entry.lastVersion;
  if (entry.lastAnalyzedAt !== undefined)
    row.last_analyzed_at = entry.lastAnalyzedAt;
  if (entry.state !== undefined) row.state = entry.state;
  if (entry.recapFileId !== undefined) row.recap_file_id = entry.recapFileId;
  if (entry.recapJson !== undefined) row.recap_json = entry.recapJson;

  const { data, error } = await sb
    .from("pma_file_registry")
    .upsert(row, { onConflict: "workspace_id,source_file_id" })
    .select("*")
    .single();
  if (error) throw error;
  return mapRegistryRow(data as Record<string, unknown>);
}

// Fetch one registry row by its natural key, or null if not yet seeded. The
// cheap version-gate lookup (DESIGN §3 gate C reads registry.last_version).
export async function getRegistryEntry(
  workspaceId: string,
  sourceFileId: string,
): Promise<PmaFileRegistryRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("pma_file_registry")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source_file_id", sourceFileId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRegistryRow(data as Record<string, unknown>) : null;
}

// List every registry row for a workspace (the full Drive projection) — for
// deletion/orphan detection and reconciliation. Ordered by source_file_id for
// a stable result.
export async function listRegistry(
  workspaceId: string,
): Promise<PmaFileRegistryRow[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("pma_file_registry")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("source_file_id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRegistryRow);
}

// ── pma_analysis_runs ────────────────────────────────────────────────────────

// The run-index fields recorded at the end of a "Run analysis" (DESIGN §4.4).
// Pointers only — `counts` is a small {changed,missed,removed} summary; the
// report TEXT lives in the Drive Doc reached via reportWebViewLink.
export type RunRecord = {
  workspaceId: string;
  triggeredBy?: string | null;
  status?: string | null;
  counts?: Record<string, number> | null;
  reportFileId?: string | null;
  reportWebViewLink?: string | null;
  runAt?: string | null; // ISO timestamp; omit to use DB default now()
  // U12.12 — the run's date window (null = whole-document) + content fingerprint.
  windowStart?: string | null;
  windowEnd?: string | null;
  fingerprint?: Record<string, string> | null;
  // 0144 — config snapshot { sections, length, customPrompt } for history restore.
  settings?: Record<string, unknown> | null;
};

// Insert one analysis-run history row and return it. Each call appends a new
// run (no upsert — runs are an append-only history for the Analysis tab list).
export async function recordRun(run: RunRecord): Promise<PmaAnalysisRunRow> {
  const sb = getServiceSupabase();
  const row: Record<string, unknown> = {
    workspace_id: run.workspaceId,
  };
  if (run.triggeredBy !== undefined) row.triggered_by = run.triggeredBy;
  if (run.status !== undefined) row.status = run.status;
  if (run.counts !== undefined) row.counts = run.counts;
  if (run.reportFileId !== undefined) row.report_file_id = run.reportFileId;
  if (run.reportWebViewLink !== undefined)
    row.report_web_view_link = run.reportWebViewLink;
  if (run.runAt !== undefined && run.runAt !== null) row.run_at = run.runAt;
  if (run.windowStart !== undefined) row.window_start = run.windowStart;
  if (run.windowEnd !== undefined) row.window_end = run.windowEnd;
  if (run.fingerprint !== undefined) row.fingerprint = run.fingerprint;
  if (run.settings !== undefined) row.settings = run.settings;

  const { data, error } = await sb
    .from("pma_analysis_runs")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return mapRunRow(data as Record<string, unknown>);
}

// U12.12 — the most recent SUCCESS run for an exact window (null/null =
// whole-document), or null if none. Used to dedup a re-run of the same range:
// same window + same fingerprint ⇒ nothing changed, point at the existing report.
export async function findRunByWindow(
  workspaceId: string,
  windowStart: string | null,
  windowEnd: string | null,
): Promise<PmaAnalysisRunRow | null> {
  const sb = getServiceSupabase();
  let q = sb
    .from("pma_analysis_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "success");
  q = windowStart === null ? q.is("window_start", null) : q.eq("window_start", windowStart);
  q = windowEnd === null ? q.is("window_end", null) : q.eq("window_end", windowEnd);
  const { data, error } = await q
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRunRow(data as Record<string, unknown>) : null;
}

// List a workspace's analysis runs, newest first (the Analysis-tab history feed,
// DESIGN §4.4, §6). Matches the (workspace_id, run_at desc) index.
export async function listRuns(
  workspaceId: string,
): Promise<PmaAnalysisRunRow[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("pma_analysis_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("run_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRunRow);
}

// ── pma_workspace_state ──────────────────────────────────────────────────────
// The Drive Changes API checkpoint (DESIGN §4.5). Read at the start of a run to
// fetch changes incrementally; written at run end as the "since previous
// analysis" checkpoint. null on the first run → detect() bootstraps.

export async function getWorkspacePageToken(
  workspaceId: string,
): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("pma_workspace_state")
    .select("changes_page_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const tok = (data as Record<string, unknown> | null)?.changes_page_token;
  return typeof tok === "string" ? tok : null;
}

// Idempotent upsert of the checkpoint. Called once at the end of a successful
// run with detect()'s newPageToken.
export async function setWorkspacePageToken(
  workspaceId: string,
  token: string,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("pma_workspace_state").upsert(
    {
      workspace_id: workspaceId,
      changes_page_token: token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw error;
}

// U3 — persist the per-workspace report-section selection. Called at the START
// of a run so the chosen combination is remembered even when the run yields no
// new report (e.g. empty period). The upsert sets only report_sections (+
// updated_at), so an existing changes_page_token checkpoint is preserved on
// conflict and a brand-new row simply leaves it null (detect bootstraps it).
// Input is sanitized to known keys/booleans before it touches the database.
export async function setWorkspaceReportSections(
  workspaceId: string,
  sections: ReportSections,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("pma_workspace_state").upsert(
    {
      workspace_id: workspaceId,
      report_sections: sanitizeReportSections(sections),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw error;
}

// 0143 — persist the per-workspace report length + custom focus prompt, saved at
// run start (like report_sections). Only the provided columns are written, so the
// other pma_workspace_state columns (sections, page token) are preserved on
// conflict. Values are sanitized before they touch the database.
export async function setWorkspaceReportSettings(
  workspaceId: string,
  input: { reportLength?: ReportLength; customPrompt?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
  };
  if (input.reportLength !== undefined)
    patch.report_length = sanitizeReportLength(input.reportLength);
  if (input.customPrompt !== undefined)
    patch.custom_prompt = sanitizeCustomPrompt(input.customPrompt);
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("pma_workspace_state")
    .upsert(patch, { onConflict: "workspace_id" });
  if (error) throw error;
}

// Effective report settings for a workspace (sanitized; defaults when unset).
// Read at run start so a run that doesn't carry them (e.g. a scheduled run) still
// honours the workspace's standing length + focus.
export async function getWorkspaceReportSettings(
  workspaceId: string,
): Promise<{ reportLength: ReportLength; customPrompt: string | null }> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("pma_workspace_state")
    .select("report_length, custom_prompt")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  return {
    reportLength: sanitizeReportLength(row?.report_length),
    customPrompt: sanitizeCustomPrompt(row?.custom_prompt),
  };
}
