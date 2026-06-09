import "server-only";

import { Type } from "@google/genai";
import type { Schema } from "@google/genai";

import { compareToBaseline } from "@/lib/baselines/compare";
import type {
  BaselineDetail,
  LiveEntry,
  LiveMilestone,
  VarianceResult,
} from "@/lib/baselines/types";
import { generateStructured } from "./clients/gemini";
import { createReport } from "./output";
import type { AnalyzeFileResult } from "./analyze";
import type { DetectedFile } from "./detect";

// PMA U7 — AGGREGATE + DEVIATION + REPORT (DESIGN §3 step E, §5.2).
//
// Takes the per-file recaps from analyze() (U6), the removed/missed lists, and
// the Approved roadmap baseline vs the LIVE roadmap, then asks Gemini Pro to
// synthesise a single workspace report and writes it as a native Google Doc in
// the OUTPUT folder's analyses/ sub-folder.
//
// GROUNDED DEVIATION (DESIGN §5.2). The date/scope/order variance is computed by
// the existing, deterministic compareToBaseline() — NOT by the model. Gemini
// receives the already-computed deltas and only narrates them, so it can never
// invent a slip or a date.
//
// SCOPE BOUNDARIES (mirror analyze, DESIGN §1):
//  - WRITES only the OUTPUT tree (via output.createReport). Never the Source.
//  - Does NOT touch the Postgres registry or pma_analysis_runs — recording the
//    run (step G) belongs to U8 reconcile / U9 orchestration. This unit returns
//    the report + Doc pointer + counts; the orchestrator persists them.
//  - A Gemini failure THROWS: unlike a single per-file recap, the synthesis is
//    the whole-run deliverable, so its failure is terminal for the run (U9
//    catches it and records a failed run).

// One grounded deviation line for the report (DESIGN §5.2).
export type Deviation = {
  item: string;
  baseline_value: string;
  current_value: string;
  type: "delay" | "scope" | "reorder";
  severity: "low" | "medium" | "high";
};

// Structured workspace synthesis (DESIGN §5.2).
export type SynthesisReport = {
  executive_summary: string;
  // Dedicated paragraph on deliverable files (DESIGN §1, §6).
  deliverables_focus: string;
  notable_changes: string[];
  new_or_changed_files: string[];
  missed_updates: string[];
  deviations: Deviation[];
  progress_notes: string[];
  difficulties: string[];
};

export type SynthesizeInput = {
  workspaceId: string;
  outputFolderId: string;
  // Display label (UTC+1) for the Doc title/header. Passed in by the
  // orchestrator so this unit stays deterministic (no clock read here).
  runLabel: string;
  // U12.2 — the reporting window (ISO, inclusive). When present, the report is
  // titled + scoped to this period and the model is told to cover only it.
  window?: { start: string; end: string };
  // Per-file recaps from analyze() (DESIGN §5.2 — in-memory).
  fileResults: AnalyzeFileResult[];
  // Files detected as removed this run (DESIGN §5.2 removed list).
  removed: DetectedFile[];
  // The Approved baseline (null if the workspace has none) + the LIVE roadmap.
  baseline: BaselineDetail | null;
  live: { entries: LiveEntry[]; milestones: LiveMilestone[] };
};

export type SynthesizeResult = {
  report: SynthesisReport;
  reportFileId: string;
  reportWebViewLink: string;
  // Small summary persisted on the run row by U9 (DESIGN §4.4 counts).
  counts: { changed: number; missed: number; removed: number };
};

const DEVIATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    item: { type: Type.STRING },
    baseline_value: { type: Type.STRING },
    current_value: { type: Type.STRING },
    type: { type: Type.STRING, enum: ["delay", "scope", "reorder"] },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
  },
  required: ["item", "baseline_value", "current_value", "type", "severity"],
};

const REPORT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    executive_summary: { type: Type.STRING },
    deliverables_focus: { type: Type.STRING },
    notable_changes: { type: Type.ARRAY, items: { type: Type.STRING } },
    new_or_changed_files: { type: Type.ARRAY, items: { type: Type.STRING } },
    missed_updates: { type: Type.ARRAY, items: { type: Type.STRING } },
    deviations: { type: Type.ARRAY, items: DEVIATION_SCHEMA },
    progress_notes: { type: Type.ARRAY, items: { type: Type.STRING } },
    difficulties: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "executive_summary",
    "deliverables_focus",
    "notable_changes",
    "new_or_changed_files",
    "missed_updates",
    "deviations",
    "progress_notes",
    "difficulties",
  ],
};

const SYNTHESIS_SYSTEM =
  "You are a project-management analyst writing a workspace progress report. " +
  "You are given: per-file recaps of what changed in the project's documents, a " +
  "list of files that failed to analyse (missed updates), removed files, and a " +
  "GROUNDED comparison of the Approved roadmap baseline against the live roadmap " +
  "(date/scope/order deltas already computed for you). Synthesise a factual " +
  "report. Give deliverable files a dedicated focus paragraph. For deviations, " +
  "use ONLY the supplied baseline-vs-live deltas — never invent dates or slips. " +
  "When a reporting period is given, cover ONLY work within that period and do " +
  "not discuss activity outside it. Each changed file carries `modified_by` — " +
  "the person who last modified it (or 'non noto'); name that person as the one " +
  "who made the file's changes (e.g. in new_or_changed_files), and use the " +
  "`modified_by` value EXACTLY as given (verbatim — do not reformat or rewrite " +
  "the name). Refer to files by the `file` value given (a human name), never by " +
  "any id. Be specific and terse; do not invent content. Respond only as JSON " +
  "matching the provided schema.";

// The compact, model-facing payload. Kept small and structured: only the signal
// (one-line summaries, importance, risk flags, non-trivial variance) is sent —
// not the full recap bodies (those already live in the Output folder).
// U12.9 — the people to credit for a file's changes: window revision authors if
// present, else the single last modifier, else none (→ "non noto").
function whoChanged(r: AnalyzeFileResult): string[] {
  if (r.authors && r.authors.length > 0) return r.authors;
  return r.modifiedBy ? [r.modifiedBy] : [];
}

function buildPayload(
  input: SynthesizeInput,
  variance: VarianceResult | null,
  period: string | null,
) {
  const analyzed = input.fileResults.filter((r) => r.status === "analyzed" && r.recap);
  const missed = input.fileResults.filter((r) => r.status === "error");

  return {
    run: input.runLabel,
    reporting_period: period,
    changed_files: analyzed.map((r) => ({
      // U12.8 — reference the file by its human name, not the raw Drive fileId.
      file: r.name ?? r.fileId,
      summary: r.recap!.one_line_summary,
      importance: r.recap!.importance,
      is_deliverable: r.recap!.is_deliverable,
      additions: r.recap!.additions,
      edits: r.recap!.edits,
      structural_changes: r.recap!.structural_changes,
      risk_flags: r.recap!.risk_flags,
      // U12.9 — who revised the file within the period (or "non noto"); the report
      // names them. Falls back to the single last modifier when no window authors.
      modified_by: whoChanged(r).join(", ") || "non noto",
    })),
    missed_files: missed.map((r) => ({ file: r.name ?? r.fileId, error: r.error })),
    removed_files: input.removed.map((f) => ({
      file: f.fileId,
      name: f.name,
      is_deliverable: f.isDeliverable,
    })),
    baseline: input.baseline
      ? { name: input.baseline.meta.name, approved: input.baseline.meta.isApproved }
      : null,
    // Grounded deviation — only the cards/milestones that actually changed, plus
    // the rollup. Gemini narrates these; it does not recompute them.
    roadmap_variance: variance
      ? {
          rollup: variance.rollup,
          changed_cards: variance.cards.filter((c) => c.status !== "unchanged"),
          changed_milestones: variance.milestones.filter(
            (m) => m.status !== "unchanged",
          ),
        }
      : null,
  };
}

function buildPrompt(
  input: SynthesizeInput,
  variance: VarianceResult | null,
  period: string | null,
): string {
  const payload = buildPayload(input, variance, period);
  return (
    `Workspace analysis run: ${input.runLabel}\n` +
    (period
      ? `Reporting period: ${period}. Cover ONLY work within this period.\n`
      : "") +
    (variance
      ? "An Approved baseline exists — compare against the grounded variance below.\n"
      : "No Approved roadmap baseline is set for this workspace — omit deviations.\n") +
    `--- DATA START ---\n${JSON.stringify(payload, null, 2)}\n--- DATA END ---`
  );
}

// Format the reporting window as a human "dd/mm/yyyy – dd/mm/yyyy" label (UTC,
// matching the date-picker's UTC day boundaries). U12.2.
function fmtPeriod(window: { start: string; end: string }): string {
  const f = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  return `${f(window.start)} – ${f(window.end)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render the structured report as an HTML body. createReport imports text/html
// → Drive converts it to a native Google Doc carrying formatting. U12.6 — author
// names (the `authors` set, grounded in Drive's lastModifyingUser) are wrapped in
// <b> wherever they appear, so the person who made each change stands out.
export function renderReportDoc(
  report: SynthesisReport,
  runLabel: string,
  period?: string | null,
  authors: string[] = [],
): string {
  const lines: string[] = [];
  const section = (title: string) => {
    lines.push("", title.toUpperCase(), "");
  };
  const bullets = (items: string[]) => {
    if (items.length === 0) lines.push("  (none)");
    else for (const it of items) lines.push(`  • ${it}`);
  };

  lines.push(`PROJECT ANALYSIS — ${runLabel}`);
  if (period) lines.push(`Reporting period: ${period}`);

  section("Executive summary");
  lines.push(report.executive_summary || "(none)");

  section("Deliverables");
  lines.push(report.deliverables_focus || "(none)");

  section("Notable changes");
  bullets(report.notable_changes);

  section("New or changed files");
  bullets(report.new_or_changed_files);

  section("Missed updates");
  bullets(report.missed_updates);

  section("Deviations from the approved baseline");
  if (report.deviations.length === 0) {
    lines.push("  (none)");
  } else {
    for (const d of report.deviations) {
      lines.push(
        `  • [${d.type}/${d.severity}] ${d.item}: ${d.baseline_value} → ${d.current_value}`,
      );
    }
  }

  section("Progress notes");
  bullets(report.progress_notes);

  section("Difficulties");
  bullets(report.difficulties);

  // U12.6 — emit HTML. Escape every line first, then bold any author name within
  // it (longest names first so overlapping names don't nest). Lines join with
  // <br>; "non noto" is left unbolded (it is not a recognizable person).
  const names = [...authors]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => escapeHtml(n));
  const bold = (escapedLine: string): string => {
    let out = escapedLine;
    for (const n of names) out = out.split(n).join(`<b>${n}</b>`);
    return out;
  };
  const body = lines.map((l) => bold(escapeHtml(l))).join("<br>\n");
  return `<html><body>${body}</body></html>`;
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  // Grounded deviation — deterministic, computed from data, fed to the model.
  const variance: VarianceResult | null = input.baseline
    ? compareToBaseline(input.live, input.baseline)
    : null;

  // U12.2 — human period label for the title/header/prompt (null if unwindowed).
  const period = input.window ? fmtPeriod(input.window) : null;

  const report = await generateStructured<SynthesisReport>({
    model: "gemini-2.5-pro",
    systemInstruction: SYNTHESIS_SYSTEM,
    prompt: buildPrompt(input, variance, period),
    responseSchema: REPORT_SCHEMA,
    temperature: 0,
  });

  // U12.6/U12.9 — the grounded set of author names to bold in the rendered
  // report: every person who revised any analyzed file within the period.
  const authors = Array.from(
    new Set(
      input.fileResults
        .filter((r) => r.status === "analyzed")
        .flatMap((r) => whoChanged(r))
        .filter((n): n is string => !!n),
    ),
  );
  const content = renderReportDoc(report, input.runLabel, period, authors);
  const { id, webViewLink } = await createReport(input.outputFolderId, {
    name: period
      ? `Analysis ${period} — ${input.runLabel}`
      : `Analysis — ${input.runLabel}`,
    content,
  });

  return {
    report,
    reportFileId: id,
    reportWebViewLink: webViewLink,
    counts: {
      changed: input.fileResults.filter((r) => r.status === "analyzed").length,
      missed: input.fileResults.filter((r) => r.status === "error").length,
      removed: input.removed.length,
    },
  };
}
