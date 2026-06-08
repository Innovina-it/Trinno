import "server-only";

import { getServiceSupabase } from "@/lib/supabase/service-role";
import type {
  PmaFileRegistryRow,
  PmaAnalysisRunRow,
} from "@/lib/db/schema";

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

  const { data, error } = await sb
    .from("pma_analysis_runs")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return mapRunRow(data as Record<string, unknown>);
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
