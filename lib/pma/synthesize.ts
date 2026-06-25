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
import {
  escapeHtml,
  docShell,
  section,
  paragraph,
  bullets,
  metaTable,
  table,
  monoCell,
  MONO,
} from "./doc-style";
import type { AnalyzeFileResult } from "./analyze";
import type { DetectedFile } from "./detect";
import {
  REPORT_SECTION_KEYS,
  isSectionEnabled,
  type ReportSectionKey,
  type ReportSections,
} from "./report-sections";

// PMA U7 — AGGREGATE + DEVIATION + REPORT (DESIGN §3 step E, §5.2).
//
// Takes the per-file recaps from analyze() (U6), the removed/missed lists, and
// the Approved roadmap baseline vs the LIVE roadmap, then asks Gemini (Flash) to
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
  // U12.12 — files changed since the previous report of this same window (names).
  changedSince?: string[];
  // Project background gathered from the workspace's Context folder (text, already
  // concatenated + capped by lib/pma/context.ts). Injected as grounding so the
  // report is framed against the project's goals/terminology; absent → unchanged.
  context?: string;
  // Workspace name, for the report Doc masthead title ("<name> · Analysis").
  // Optional: absent → the masthead reads just "Analysis".
  workspaceName?: string | null;
  // Per-file recaps from analyze() (DESIGN §5.2 — in-memory).
  fileResults: AnalyzeFileResult[];
  // Files detected as removed this run (DESIGN §5.2 removed list).
  removed: DetectedFile[];
  // Count of files whose Drive revision history could not be read this run (a
  // Drive error, NOT genuine emptiness — set by detect). > 0 → the report carries
  // a deterministic "history unavailable" notice so the reader knows attribution
  // and period coverage for that many files may be incomplete. Absent/0 → silent.
  revisionErrorCount?: number;
  // The Approved baseline (null if the workspace has none) + the LIVE roadmap.
  baseline: BaselineDetail | null;
  live: { entries: LiveEntry[]; milestones: LiveMilestone[] };
  // Per-workspace report-section selection (U3); null/absent → all sections on.
  sections?: ReportSections | null;
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
  "You may also be given PROJECT CONTEXT — background on the project's goals, " +
  "scope, terminology, and stakeholders. Use it to interpret and frame the report " +
  "accurately; treat it as background only, never as recent activity to report. " +
  "When a reporting period is given, cover ONLY work within that period and do " +
  "not discuss activity outside it. Each changed file carries `modified_by` — " +
  "the person who last modified it (or 'unknown'); name that person as the one " +
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
    changed_since_last_report: input.changedSince ?? [],
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
      modified_by: whoChanged(r).join(", ") || "unknown",
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
    (input.changedSince && input.changedSince.length
      ? `This is a re-run of the same period; files changed since the previous report: ${input.changedSince.join(", ")}.\n`
      : "") +
    (variance
      ? "An Approved baseline exists — compare against the grounded variance below.\n"
      : "No Approved roadmap baseline is set for this workspace — omit deviations.\n") +
    (input.context
      ? `--- PROJECT CONTEXT START ---\n${input.context}\n--- PROJECT CONTEXT END ---\n` +
        "Use the project context above only as background to interpret and frame " +
        "the report; it is not itself recent activity to report.\n"
      : "") +
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

// Render the structured report as a Trinno-branded Google Doc (lib/pma/doc-style
// builds the import-safe HTML; createReport hands it to Drive, which converts it
// to a native Doc). U12.6 — author names (the `authors` set, grounded in Drive's
// lastModifyingUser) are wrapped in <b> wherever they appear, so the person who
// made each change stands out. "non noto" is left unbolded.
export function renderReportDoc(input: {
  report: SynthesisReport;
  runLabel: string;
  period?: string | null;
  authors?: string[];
  workspaceName?: string | null;
  counts?: { changed: number; missed: number; removed: number } | null;
  // > 0 → render a deterministic notice that history for that many files could
  // not be read (a Drive error, not absence). Absent/0 → no notice (the doc is
  // byte-identical to before this field existed).
  revisionErrorCount?: number;
  // Per-workspace section selection (U3). A section renders unless explicitly
  // false; null/absent → all 8 on, byte-identical to before this field existed.
  sections?: ReportSections | null;
  // Per-file quality + risk signal for the deterministic "Quality & risks"
  // section. Surfaced verbatim from each file's recap (never re-narrated by the
  // model). Absent/empty → the section renders "(none)".
  qualityRisks?: Array<{ file: string; quality: string; risks: string[] }> | null;
}): string {
  const { report, runLabel, period, counts, revisionErrorCount } = input;

  // Bold known author names within already-escaped text (longest first so
  // overlapping names don't nest); fmt = escape then bold.
  const names = [...(input.authors ?? [])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => escapeHtml(n));
  const bold = (escaped: string): string => {
    let out = escaped;
    for (const n of names) out = out.split(n).join(`<b>${n}</b>`);
    return out;
  };
  const fmt = (text: string): string => bold(escapeHtml(text));

  const meta: [string, string][] = [
    ["Run", runLabel],
    ["Period", period ?? "Whole document"],
  ];
  if (counts) {
    meta.push([
      "Changes",
      `${counts.changed} changed · ${counts.missed} missed · ${counts.removed} removed`,
    ]);
  }

  const deviations =
    report.deviations.length === 0
      ? paragraph("(none)")
      : table(
          ["Item", "Type", "Severity", "Baseline → Now"],
          report.deviations.map((d) => [
            fmt(d.item),
            monoCell(d.type),
            monoCell(d.severity),
            `<span style="font-family:${MONO};font-size:11px">${escapeHtml(d.baseline_value)} → ${escapeHtml(d.current_value)}</span>`,
          ]),
        );

  // Per-file quality + risk table (deterministic — straight from each file's
  // recap, never re-narrated). Empty risks → "—"; no analyzed files → "(none)".
  const qr = input.qualityRisks ?? [];
  const qualityRisks =
    qr.length === 0
      ? paragraph("(none)")
      : table(
          ["File", "Quality", "Risks"],
          qr.map((r) => [
            fmt(r.file),
            r.quality ? escapeHtml(r.quality) : "—",
            r.risks.length > 0 ? r.risks.map(escapeHtml).join("<br>") : "—",
          ]),
        );

  // Deterministic disclosure (NOT model-generated, so it can't be omitted or
  // reworded): when revisions for some files could not be read, say so at the top
  // of the report rather than letting a Drive error read as "nothing changed".
  // Rendered only when > 0 → the doc stays byte-identical when every read succeeded.
  const historyNotice =
    revisionErrorCount && revisionErrorCount > 0
      ? section("History unavailable") +
        paragraph(
          escapeHtml(
            `History unavailable for ${revisionErrorCount} file${revisionErrorCount === 1 ? "" : "s"}: a Google Drive error prevented ${revisionErrorCount === 1 ? "its" : "their"} revisions from being read. Attribution and period coverage for those files may be incomplete.`,
          ),
        )
      : "";

  // Each toggleable section's HTML, keyed by the shared registry. Order comes
  // from REPORT_SECTION_KEYS (same as before this refactor), so an all-on
  // selection renders byte-identically to the previous fixed concatenation.
  const sectionHtml: Record<ReportSectionKey, string> = {
    executive_summary:
      section("Executive summary") + paragraph(fmt(report.executive_summary)),
    deliverables:
      section("Deliverables") + paragraph(fmt(report.deliverables_focus)),
    notable_changes:
      section("Notable changes") + bullets(report.notable_changes.map(fmt)),
    new_or_changed_files:
      section("New or changed files") + bullets(report.new_or_changed_files.map(fmt)),
    missed_updates:
      section("Missed updates") + bullets(report.missed_updates.map(fmt)),
    deviations: section("Deviations from the approved baseline") + deviations,
    quality_risks: section("Quality and risks") + qualityRisks,
    progress_notes:
      section("Progress notes") + bullets(report.progress_notes.map(fmt)),
    difficulties: section("Difficulties") + bullets(report.difficulties.map(fmt)),
  };

  const body =
    historyNotice +
    `<div style="margin:0 0 22px">${metaTable(meta)}</div>` +
    REPORT_SECTION_KEYS.filter((k) => isSectionEnabled(input.sections, k))
      .map((k) => sectionHtml[k])
      .join("");

  return docShell({
    eyebrow: "Trinno · Project analysis",
    title: input.workspaceName ? `${input.workspaceName} · Analysis` : "Analysis",
    subLines: [{ text: period ? `Reporting period · ${period}` : "Whole document" }],
    body,
    footer: "Generated by Trinno · gemini-3.5-flash",
  });
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  // Grounded deviation — deterministic, computed from data, fed to the model.
  const variance: VarianceResult | null = input.baseline
    ? compareToBaseline(input.live, input.baseline)
    : null;

  // U12.2 — human period label for the title/header/prompt (null if unwindowed).
  const period = input.window ? fmtPeriod(input.window) : null;

  const report = await generateStructured<SynthesisReport>({
    model: "gemini-3.5-flash",
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
  const counts = {
    changed: input.fileResults.filter((r) => r.status === "analyzed").length,
    missed: input.fileResults.filter((r) => r.status === "error").length,
    removed: input.removed.length,
  };
  // Per-file quality + risk signal for the "Quality & risks" section. Surfaced
  // verbatim from each analyzed file's recap — the model never re-narrates it.
  const qualityRisks = input.fileResults
    .filter((r) => r.status === "analyzed" && r.recap)
    .map((r) => ({
      file: r.name ?? r.fileId,
      quality: r.recap!.quality_judgment,
      risks: r.recap!.risk_flags,
    }));
  const content = renderReportDoc({
    report,
    runLabel: input.runLabel,
    period,
    authors,
    workspaceName: input.workspaceName,
    counts,
    revisionErrorCount: input.revisionErrorCount,
    sections: input.sections,
    qualityRisks,
  });
  const { id, webViewLink } = await createReport(input.outputFolderId, {
    name: period
      ? `Analysis ${period} · ${input.runLabel}`
      : `Analysis · ${input.runLabel}`,
    content,
  });

  return {
    report,
    reportFileId: id,
    reportWebViewLink: webViewLink,
    counts,
  };
}
