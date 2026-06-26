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

// One difficulty, with a severity grounded in how the source frames its impact
// (#8) — never the model's own weighting.
export type Difficulty = {
  description: string;
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
  difficulties: Difficulty[];
  // Forward-looking narrated sections (#2). All grounded ONLY in the reported
  // changes/deviations/risks/context; empty when nothing in the inputs supports
  // them (budget_notes: empty unless the documents actually mention budget).
  next_steps: string[];
  recommendations: string[];
  risk_outlook: string;
  budget_notes: string[];
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
  // #5b — `deliverables` = distinct deliverables behind the analysed files
  // (EN/IT/pptx copies count once); optional so old persisted runs stay valid.
  counts: {
    changed: number;
    missed: number;
    removed: number;
    deliverables?: number;
  };
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

const DIFFICULTY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
  },
  required: ["description", "severity"],
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
    difficulties: { type: Type.ARRAY, items: DIFFICULTY_SCHEMA },
    next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
    risk_outlook: { type: Type.STRING },
    budget_notes: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    "next_steps",
    "recommendations",
    "risk_outlook",
    "budget_notes",
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
  "any id. In `new_or_changed_files`, each entry must state WHAT changed in that " +
  "file (drawn from its additions/edits/summary), not merely name the file. A " +
  "changed file with `looks_superseded` true is an OLDER or superseded generation " +
  "of a deliverable: describe it as such and never blend its figures with the " +
  "current (non-superseded) deliverables — when an old and a current version " +
  "disagree, the current one governs. Be specific and terse; do not invent content. " +
  "Never state a number, measurement, duration, percentage or standard/" +
  "regulation code (e.g. an IEC/ISO/EN number, a GDPR or AI Act article) that " +
  "is not present in the supplied data above; do not import figures from prior " +
  "reports or background knowledge. In `difficulties`, list ONLY what a source " +
  "explicitly frames as a problem, limitation or risk — never something the " +
  "source calls adequate, sufficient or acceptable — and give each a `severity` " +
  "(low/medium/high) grounded in how the source frames its impact, not your own " +
  "weighting. When the inputs cite a set " +
  "of regulations together (e.g. GDPR + AI Act Reg. 2024/1689 + Workers' " +
  "Statute Art. 4), name every member, never a subset. " +
  "Also produce four forward-looking sections, grounded ONLY in the reported " +
  "changes, deviations, risks and context — never invented: `next_steps` " +
  "(concrete actions that clearly follow from what was reported), " +
  "`recommendations` (analyst advice to the team), `risk_outlook` (a short " +
  "forward-looking paragraph on where the project is exposed, based on the " +
  "deviations, risk flags and missed updates), and `budget_notes` " +
  "(budget/effort observations ONLY if the documents or PROJECT CONTEXT " +
  "actually mention them — never fabricate figures or estimates). Leave any of " +
  "these empty ([] or \"\") when nothing in the inputs supports it. " +
  "Respond only as JSON matching the provided schema.";

// The compact, model-facing payload. Kept small and structured: only the signal
// (one-line summaries, importance, risk flags, non-trivial variance) is sent —
// not the full recap bodies (those already live in the Output folder).
// U12.9 — the people to credit for a file's changes: window revision authors if
// present, else the single last modifier, else none (→ "non noto").
function whoChanged(r: AnalyzeFileResult): string[] {
  if (r.authors && r.authors.length > 0) return r.authors;
  return r.modifiedBy ? [r.modifiedBy] : [];
}

// #4 — a file that belongs to an older/superseded generation, recognised either
// by its own NAME or by an ancestor FOLDER name (e.g. a file inside "First Output
// (old)"). Conservative pattern. Used ONLY to FLAG — never to exclude — so the
// model never blends an old draft's committed figures with the current,
// deliberately-prudent deliverables.
const SUPERSEDED_RX = /\(old\)|\bold\b|supersed|obsolet|vecchi|deprecat/i;

export function looksSuperseded(
  name: string | null | undefined,
  folderPath?: string[],
): boolean {
  if (name && SUPERSEDED_RX.test(name)) return true;
  return (folderPath ?? []).some((segment) => SUPERSEDED_RX.test(segment));
}

// #5b — the deliverable a file belongs to: its task code (T2.1, T3.2, …) when the
// name carries one, else the file's own name (so files without a code never merge
// with anything). Lets the report show one row per deliverable instead of one per
// EN/IT/pptx copy of the same document.
export function deliverableKey(name: string | null | undefined): string {
  const n = name ?? "";
  const m = n.match(/T\d+\.\d+/i);
  return m ? m[0].toUpperCase() : n;
}

type QualityRiskRow = { file: string; status: string; quality: string; risks: string[] };
type RawQualityRisk = Omit<QualityRiskRow, "file"> & {
  rawName: string;
  superseded: boolean;
};

// #5b — collapse the EN/IT/pptx copies of one deliverable into a SINGLE row
// (representative = a non-pptx copy when available, else the first), noting how
// many versions were folded. NEVER merges across the superseded boundary (5a): a
// flagged old-generation file always stays its own row, so an old draft is never
// folded into the current deliverable. Returns the display rows (current
// deliverables first, then any superseded rows) + the deliverable count.
export function groupByDeliverable(
  entries: RawQualityRisk[],
): { rows: QualityRiskRow[]; deliverableCount: number } {
  const groups = new Map<string, RawQualityRisk[]>();
  const supersededRows: QualityRiskRow[] = [];
  for (const e of entries) {
    if (e.superseded) {
      supersededRows.push({
        file: `${e.rawName} (likely superseded draft)`,
        status: e.status,
        quality: e.quality,
        risks: e.risks,
      });
      continue;
    }
    const key = deliverableKey(e.rawName);
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(e);
  }
  const groupRows: QualityRiskRow[] = [];
  for (const g of groups.values()) {
    const rep = g.find((e) => !/\.pptx$/i.test(e.rawName)) ?? g[0];
    const extra = g.length - 1;
    groupRows.push({
      file:
        extra > 0
          ? `${rep.rawName} (+${extra} more version${extra === 1 ? "" : "s"}: same deliverable)`
          : rep.rawName,
      status: rep.status,
      quality: rep.quality,
      risks: rep.risks,
    });
  }
  const rows = [...groupRows, ...supersededRows];
  return { rows, deliverableCount: rows.length };
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
      // #4 — older/superseded generation (by name OR ancestor folder). The model
      // is told not to blend its figures with the current deliverables; never
      // used to drop the file.
      looks_superseded: looksSuperseded(r.name, r.folderPath),
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
  qualityRisks?: Array<{
    file: string;
    status: string;
    quality: string;
    risks: string[];
  }> | null;
  // Grounded substantiation for an EMPTY Deviations section (#7): the approved
  // baseline's name (or null when none is set) and how many roadmap items were
  // compared against it. Provided by synthesize() from input.baseline + variance.
  // When `baselineName` is undefined (legacy callers/tests), an empty Deviations
  // section falls back to "(none)" — byte-identical to before these fields existed.
  baselineName?: string | null;
  comparedCount?: number | null;
  // #5b — number of distinct deliverables behind the analysed files (EN/IT/pptx
  // copies of one document count once). When present AND fewer than counts.changed,
  // the header reads "D deliverables · N changed …"; absent → the legacy label.
  deliverableCount?: number | null;
}): string {
  const { report, runLabel, period, counts, revisionErrorCount } = input;
  const { baselineName, comparedCount, deliverableCount } = input;

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
    // The count is SOURCE files consulted this run, not files we edited — so the
    // label says a neutral "N files", never "changed"/"analysed", which read as if
    // the analysis modified them (#3). #5b — when several files are copies of one
    // deliverable, prefix the deliverable count: "6 deliverables · 18 files". Only
    // when grouping actually collapses something (D < N); absent/equal → just files.
    const showGroups =
      deliverableCount != null && deliverableCount < counts.changed;
    const fileWord = counts.changed === 1 ? "file" : "files";
    meta.push([
      "Changes",
      (showGroups
        ? `${deliverableCount} deliverable${deliverableCount === 1 ? "" : "s"} · `
        : "") +
        `${counts.changed} ${fileWord} · ${counts.missed} missed · ${counts.removed} removed`,
    ]);
  }

  // Substantiate an empty Deviations section (#7): say what was checked instead of
  // a bare "(none)". Grounded only — N comes from the deterministic variance and
  // the baseline name from the registry; the model never produces this line. When
  // baselineName is undefined (legacy/tests) → "(none)", byte-identical to before.
  const deviations =
    report.deviations.length > 0
      ? table(
          ["Item", "Type", "Severity", "Baseline → Now"],
          report.deviations.map((d) => [
            fmt(d.item),
            monoCell(d.type),
            monoCell(d.severity),
            `<span style="font-family:${MONO};font-size:11px">${escapeHtml(d.baseline_value)} → ${escapeHtml(d.current_value)}</span>`,
          ]),
        )
      : baselineName === undefined
        ? paragraph("(none)")
        : baselineName
          ? paragraph(
              `Compared ${comparedCount ?? 0} roadmap item${comparedCount === 1 ? "" : "s"} against the approved baseline "${escapeHtml(baselineName)}" — no deviations found.`,
            )
          : paragraph(
              "No approved baseline is set for this workspace, so deviations were not checked.",
            );

  // Substantiate an empty Missed-updates section (#7): every analysed file parsed
  // cleanly, so say so (with the count) rather than "(none)". Uses the already-
  // passed `counts`; absent → bullets([]) keeps the legacy "(none)".
  const missedUpdates =
    report.missed_updates.length > 0
      ? bullets(report.missed_updates.map(fmt))
      : counts
        ? paragraph(
            counts.changed === 0
              ? "No files were analysed this run."
              : `All ${counts.changed} analysed file${counts.changed === 1 ? "" : "s"} were read successfully — no missed updates.`,
          )
        : bullets([]);

  // Difficulties as a table carrying a grounded severity badge (#8). Empty →
  // "(none)", byte-identical to the previous bullet rendering when there are none.
  const difficulties =
    report.difficulties.length === 0
      ? paragraph("(none)")
      : table(
          ["Difficulty", "Severity"],
          report.difficulties.map((d) => [fmt(d.description), monoCell(d.severity)]),
        );

  // Per-file quality + risk table (deterministic — straight from each file's
  // recap, never re-narrated). Empty risks → "—"; no analyzed files → "(none)".
  const qr = input.qualityRisks ?? [];
  const qualityRisks =
    qr.length === 0
      ? paragraph("(none)")
      : table(
          ["File", "Status", "Quality", "Risks"],
          qr.map((r) => [
            fmt(r.file),
            monoCell(r.status || "unknown"),
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
    missed_updates: section("Missed updates") + missedUpdates,
    deviations: section("Deviations from the approved baseline") + deviations,
    quality_risks: section("Quality and risks") + qualityRisks,
    progress_notes:
      section("Progress notes") + bullets(report.progress_notes.map(fmt)),
    difficulties: section("Difficulties") + difficulties,
    next_steps: section("Next steps") + bullets(report.next_steps.map(fmt)),
    recommendations:
      section("Recommendations") + bullets(report.recommendations.map(fmt)),
    risk_outlook: section("Risk outlook") + paragraph(fmt(report.risk_outlook)),
    budget_notes: section("Budget notes") + bullets(report.budget_notes.map(fmt)),
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
  // #5b — one raw row per analysed file, tagged with whether it is a superseded
  // (5a) copy, then grouped: EN/IT/pptx copies of one deliverable collapse to a
  // single row; superseded files stay their own (flagged) rows, never merged.
  const rawQualityRisks = input.fileResults
    .filter((r) => r.status === "analyzed" && r.recap)
    .map((r) => ({
      rawName: r.name ?? r.fileId,
      superseded: looksSuperseded(r.name, r.folderPath),
      status: r.recap!.file_status,
      quality: r.recap!.quality_judgment,
      risks: r.recap!.risk_flags,
    }));
  const { rows: qualityRisks, deliverableCount } =
    groupByDeliverable(rawQualityRisks);
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
    // Grounded substantiation for an empty Deviations section (#7).
    baselineName: input.baseline ? input.baseline.meta.name : null,
    comparedCount: variance
      ? variance.cards.length + variance.milestones.length
      : null,
    // #5b — distinct deliverables behind the analysed files (EN/IT/pptx → 1).
    deliverableCount,
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
    // #5b — persist the deliverable count so the analysis page can show
    // "6 deliverables · 18 files" without re-deriving it from file names.
    counts: { ...counts, deliverables: deliverableCount },
  };
}
