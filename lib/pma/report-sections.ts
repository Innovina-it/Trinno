// PMA report sections — the single source of truth for which sections the
// synthesis report can render, shared by the renderer (lib/pma/synthesize.ts)
// and the Run-analysis UI (components/pma/run-analysis-panel.tsx).
//
// Per-workspace on/off lives in pma_workspace_state.report_sections (migration
// 0141). A section renders UNLESS it is explicitly false, so sections added to
// this list later default ON for every workspace without touching the
// combinations already saved.

// The toggleable sections, in render order (mirrors renderReportDoc's body).
export const REPORT_SECTION_KEYS = [
  "executive_summary",
  "deliverables",
  "notable_changes",
  "new_or_changed_files",
  "missed_updates",
  "deviations",
  "quality_risks",
  "progress_notes",
  "difficulties",
  "next_steps",
  "recommendations",
  "risk_outlook",
  "budget_notes",
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

// Human labels for the UI checkboxes (mirror the headings in renderReportDoc).
export const REPORT_SECTION_LABELS: Record<ReportSectionKey, string> = {
  executive_summary: "Executive summary",
  deliverables: "Deliverables",
  notable_changes: "Notable changes",
  new_or_changed_files: "New or changed files",
  missed_updates: "Missed updates",
  deviations: "Deviations from the approved baseline",
  quality_risks: "Quality and risks",
  progress_notes: "Progress notes",
  difficulties: "Difficulties",
  next_steps: "Next steps",
  recommendations: "Recommendations",
  risk_outlook: "Risk outlook",
  budget_notes: "Budget notes",
};

// UI grouping for the Run-analysis outline: the toggles read as the outline of
// the document the run will produce, four named parts mirroring the report's
// arc. Flattening the groups in order reproduces REPORT_SECTION_KEYS exactly, so
// render order and grouping stay in sync (guarded by a unit test).
export const REPORT_SECTION_GROUPS = [
  { label: "Overview", keys: ["executive_summary", "deliverables"] },
  {
    label: "What changed",
    keys: [
      "notable_changes",
      "new_or_changed_files",
      "missed_updates",
      "deviations",
    ],
  },
  {
    label: "Progress & quality",
    keys: ["quality_risks", "progress_notes", "difficulties"],
  },
  {
    label: "Looking ahead",
    keys: ["next_steps", "recommendations", "risk_outlook", "budget_notes"],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  keys: ReadonlyArray<ReportSectionKey>;
}>;

// The stored shape: a partial map of section → enabled. Absent/null → all on.
export type ReportSections = Partial<Record<ReportSectionKey, boolean>>;

// A section renders unless explicitly disabled. Null/absent store → enabled, so
// the default (and every pre-migration workspace) is byte-identical to before.
export function isSectionEnabled(
  sections: ReportSections | null | undefined,
  key: ReportSectionKey,
): boolean {
  return sections?.[key] !== false;
}

// Default UI state when a workspace has no saved combination: all on.
export const ALL_SECTIONS_ON: Record<ReportSectionKey, boolean> = {
  executive_summary: true,
  deliverables: true,
  notable_changes: true,
  new_or_changed_files: true,
  missed_updates: true,
  deviations: true,
  quality_risks: true,
  progress_notes: true,
  difficulties: true,
  next_steps: true,
  recommendations: true,
  risk_outlook: true,
  budget_notes: true,
};

// Coerce arbitrary input (request body / DB jsonb) to a clean ReportSections:
// keep only known keys with boolean values; drop everything else. Unknown keys
// are ignored so a stale/forged payload can never widen or corrupt the set.
export function sanitizeReportSections(input: unknown): ReportSections {
  if (!input || typeof input !== "object") return {};
  const out: ReportSections = {};
  const src = input as Record<string, unknown>;
  for (const key of REPORT_SECTION_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  return out;
}
