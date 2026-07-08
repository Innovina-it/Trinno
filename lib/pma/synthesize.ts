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
  buildOrgMap,
  resolveContributorLabels,
  type ContributorIdentity,
  type ContributorOrgEntry,
  type OrgMap,
} from "./contributor-orgs";
import {
  REPORT_SECTION_KEYS,
  isSectionEnabled,
  type ReportSectionKey,
  type ReportSections,
} from "./report-sections";
import {
  lengthDirective,
  customFocusDirective,
  type ReportLength,
} from "./report-settings";

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
// (#8) — never the model's own weighting. U4 (eval #18) — source_file names the
// document the difficulty comes from, so every line is traceable.
export type Difficulty = {
  description: string;
  severity: "low" | "medium" | "high";
  source_file?: string;
};

// U4 (eval #6/R2) — a notable change is a cited claim: what changed, in which
// document, when. The date comes from the payload's last_modified/key_dates
// ("" when unknown), never invented.
export type NotableChange = {
  claim: string;
  file: string;
  date: string;
};

// U7g — a defect OF a document (not a project problem the document describes),
// routed to whoever maintains it: internal contradictions, stale sentences,
// unresolved placeholders in content-bearing docs, naming inconsistencies,
// conflicting dates across documents. Self-clearing by construction: a fixed
// document simply stops producing its row on the next run.
export type DocumentIssue = {
  issue: string;
  files: string;
  owner: string;
  severity: "low" | "medium" | "high";
};

// Structured workspace synthesis (DESIGN §5.2).
export type SynthesisReport = {
  executive_summary: string;
  // Dedicated paragraph on deliverable files (DESIGN §1, §6).
  deliverables_focus: string;
  notable_changes: NotableChange[];
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
  // U7g — defects of the documents themselves, for their owners.
  document_issues: DocumentIssue[];
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
  // Per-workspace contributor → organization map (maintained by hand in Settings,
  // fetched by run.ts). Each file's contributors are resolved to org labels here,
  // before anything reaches Gemini: mapped → the org, unmapped → the person's name
  // verbatim. Absent/empty → name attribution, identical to before this feature.
  contributorOrgs?: ContributorOrgEntry[];
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
  // 0143 — per-workspace synthesis settings: report length (absent → 'medium',
  // the default) and a free-text focus appended to the prompt as emphasis only.
  reportLength?: ReportLength;
  customPrompt?: string | null;
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
    // U4 (eval #18) — the document this difficulty comes from ("" when it is a
    // cross-document observation).
    source_file: { type: Type.STRING },
  },
  required: ["description", "severity", "source_file"],
};

// U4 (eval #6/R2) — every notable change carries its document + date.
const NOTABLE_CHANGE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    claim: { type: Type.STRING },
    file: { type: Type.STRING },
    date: { type: Type.STRING },
  },
  required: ["claim", "file", "date"],
};

// U7g — one document defect, routed to its owner.
const DOCUMENT_ISSUE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    issue: { type: Type.STRING },
    files: { type: Type.STRING },
    owner: { type: Type.STRING },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
  },
  required: ["issue", "files", "owner", "severity"],
};

const REPORT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    executive_summary: { type: Type.STRING },
    deliverables_focus: { type: Type.STRING },
    notable_changes: { type: Type.ARRAY, items: NOTABLE_CHANGE_SCHEMA },
    new_or_changed_files: { type: Type.ARRAY, items: { type: Type.STRING } },
    missed_updates: { type: Type.ARRAY, items: { type: Type.STRING } },
    deviations: { type: Type.ARRAY, items: DEVIATION_SCHEMA },
    progress_notes: { type: Type.ARRAY, items: { type: Type.STRING } },
    difficulties: { type: Type.ARRAY, items: DIFFICULTY_SCHEMA },
    next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
    risk_outlook: { type: Type.STRING },
    budget_notes: { type: Type.ARRAY, items: { type: Type.STRING } },
    document_issues: { type: Type.ARRAY, items: DOCUMENT_ISSUE_SCHEMA },
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
    "document_issues",
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
  "who is responsible for its changes (or 'unknown'). This value may be an " +
  "ORGANIZATION or a person; credit it as the one who made the file's changes " +
  "(e.g. in new_or_changed_files), and use the `modified_by` value EXACTLY as " +
  "given (verbatim — do not reformat, rewrite, expand, or convert between a " +
  "person and an organization). Refer to files by the `file` value given (a human name), never by " +
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
  // U3 (eval #26) — budget ≠ market: TAM/ARR/pricing leaked into budget_notes
  // because 'mentions budget-shaped money' was the only test.
  "(observations about the PROJECT'S OWN budget, spending or effort ONLY. " +
  "Market sizing, revenue projections, TAM/ARR figures and product pricing " +
  "(e.g. subscription or EaaS fees) are NOT budget and must never appear " +
  "here; when the documents mention no project budget, return []). Leave any of " +
  "these empty ([] or \"\") when nothing in the inputs supports it. " +
  // U3 (eval #19) — one entity, one name: 'CER' vs 'CERA' class of drift.
  "When the inputs use variant names or acronyms for the same entity (a " +
  "committee, company or partner), use the form the official/submission " +
  "documents use, noting the variant at most once; never treat variants as " +
  "different entities. " +
  // U3 (eval #7) — supporting files are context, not deliverable progress.
  // U6 — the flag steers EMPHASIS only; naming the category in prose leaked
  // ("The supporting file D1.2 …") and mislabels deliverables whose linked flag
  // sits on another copy.
  "A changed-file entry with `is_deliverable` false gets at most one short " +
  "clause in `new_or_changed_files` and never a dedicated paragraph or a " +
  "detailed enumeration of its contents; never write the words 'supporting " +
  "file' (or any category label) in the report text — refer to every file by " +
  "its name only. " +
  // U6 — one language; recap cells drifted into the source doc's language.
  "Write the entire report in English, regardless of the source documents' " +
  "language (quote non-English titles/phrases verbatim only where exactness " +
  "matters). " +
  // U6 — the forward sections must not echo one another.
  "`next_steps` and `recommendations` must not overlap: a given action or " +
  "topic appears in exactly one of them (next_steps = concrete pending work; " +
  "recommendations = analyst advice beyond the obvious pending work), and " +
  "neither may restate a difficulty verbatim. " +
  // U7e (eval R4-5) — 'out of line, as if they dont know the context'.
  "`recommendations` carries AT MOST 3 items. Each must trace directly to a " +
  "difficulty or risk the DOCUMENTS state — never generic business or market " +
  "advice the documents do not discuss as project work. Phrase them humbly " +
  "('consider …', 'it may help to …'), as suggestions to people who know the " +
  "project better than you do; when nothing clears this bar, return []. " +
  // U2 (eval #8/#17) — the two digest sections are DEFINED, so they stop being
  // restatements of new_or_changed_files (the reviewer: "whats the consistency
  // in putting notable changes nd then this ?").
  "`notable_changes` is a digest, not a file list: the 3-5 MOST significant " +
  "substantive changes of the period and why they matter, cross-cutting the " +
  "files; it must never restate a `new_or_changed_files` entry. Each item is " +
  "{claim, file, date}: `file` = the document the claim comes from, `date` = " +
  "that entry's `last_modified` (or a `key_dates` date when the event itself " +
  "is dated); \"\" when unknown — never invent a date. " +
  // U7b (eval R4-2) — "2 +1 are the same": one event, one bullet.
  "Bullets describing the SAME real-world event or package (e.g. several " +
  "documents signed together as one submission on the same date) must merge " +
  "into ONE item naming all the files involved — never one bullet per file " +
  "of a single event. " +
  // U5 (revision delta) — verified vs current-state entries are narrated
  // differently: only verified ones may be reported as changes of the period.
  "A changed-file entry with a non-null `changes_verified_since` carries " +
  "additions/edits VERIFIED by a computed diff since that date — report those " +
  "as actual changes of the period. An entry with `changes_verified_since` " +
  "null describes CURRENT content only: present it as current state ('the " +
  "document contains/covers …'), never as something added or changed during " +
  "the period. " +
  // U4 (eval #2/#15) — anchor events; reconcile the window with the project.
  "Anchor key events (kick-off, submissions, signatures) to explicit dates " +
  "drawn from `key_dates`, `last_modified` or `filename_date` — e.g. 'kicked " +
  "off on 12/06/2026' — never leave a key event undated when a date exists. " +
  "When the documents state the project's own timeline, note it in the " +
  "executive summary; if the reporting period largely predates the project's " +
  "first documented activity, say so there in one sentence. Each `difficulties` " +
  "item carries `source_file` naming the document it comes from (\"\" only for " +
  "a cross-document observation). " +
  // U7g — the routing section: defects OF the documents, for their owners.
  "`document_issues` lists defects OF the documents themselves — problems for " +
  "whoever maintains the file, NOT project problems the documents describe " +
  "(those are `difficulties`; never put an item in both). Include: internal " +
  "contradictions (a statement its own table or a sibling section disproves), " +
  "stale sentences left from earlier versions, unresolved placeholders in " +
  "CONTENT-BEARING documents, entity/naming inconsistencies, dates or " +
  "timelines that disagree across documents, and files that appear to belong " +
  "to another project. Each item: `issue` (specific, quoting the evidence), " +
  "`files` (the document name(s)), `owner` (those files' `modified_by`, " +
  "verbatim), `severity`. Do NOT list identical text blocks copied across " +
  "documents — the system detects and reports those automatically. " +
  // U8b — the not-started list already names every unfilled template; a
  // template being empty is not a per-file defect worth a routed row.
  "Do NOT add a row merely because a deliverable is an unfilled/empty template " +
  "— those are already summarised in the not-started list; only flag a template " +
  "for a SPECIFIC defect (e.g. it belongs to another project, or its filename " +
  "contradicts a sibling). Every row MUST carry a real `owner`; if a file has " +
  "no `modified_by`, omit the row rather than writing 'unknown'. " +
  "`progress_notes` are status-versus-plan observations (what is ahead, behind " +
  "or on track and why), never a restatement of the file list. " +
  // U2 (eval #25) — one fact, one home: kills the same risk printing in the
  // difficulties table AND the risk outlook AND per-file rows.
  "Each distinct risk or difficulty must be named in exactly ONE section: " +
  "present, factual problems go in `difficulties`; forward-looking exposure " +
  "goes in `risk_outlook`; never repeat the same risk across sections — later " +
  "sections may build on it but must not restate it. " +
  // U2 (eval #7 partial / S2) — unfilled templates are inventory, not progress.
  "A changed-file entry with `is_empty_template` true is an unfilled template: " +
  "never narrate it as authored progress or give it its own bullet; mention " +
  "such files only inside ONE collective sentence (e.g. 'Not started: D2.1, " +
  "D2.2, ...') in `new_or_changed_files`. " +
  // U7d (eval R4-4) — signed beats draft: 'in the files presented this is done'.
  "A changed-file entry with `has_signed_final` true is a FINALIZED document " +
  "family (a signed or final/approved copy exists): unresolved placeholders, " +
  "internal comments and open questions in its draft copies are HISTORICAL — " +
  "already settled by the final version. Never derive next_steps or " +
  "difficulties from them; at most record one `document_issues` item noting " +
  "that a draft copy retains outdated comments. " +
  // U9b (eval R3-B) — phase awareness, confirmed by the project lead: a project
  // seeking Ethics-Committee (CERA) approval for a FEASIBILITY STUDY is
  // pre-commercialization. Notified Bodies, CE-marking and reimbursement do not
  // legally apply until the company decides to SELL the device.
  "This project is a research feasibility study under Ethics-Committee (CERA) " +
  "approval — NOT a commercialization stage. Regulatory-certification and market " +
  "topics — Notified Body / CE-marking / conformity assessment, product " +
  "reimbursement or SSN billing codes, and market/TAM sizing — are FUTURE, " +
  "sale-stage concerns that do not apply now. Never present them as current " +
  "risks, next_steps or recommendations, even if a forward-looking slide " +
  "mentions them, unless a document explicitly states the project has entered " +
  "commercialization. " +
  // U9c (eval R3-C) — be CONSISTENT about project membership: the lead noted the
  // model flags an off-project file sometimes and misses it other times.
  "Decide project membership consistently: a document about a DIFFERENT study " +
  "(a different acronym, topic or year — e.g. an S.E.O.L. exoskeleton request, a " +
  "pelvic-floor study, or any file the folder marks as an example/template from " +
  "another project) is NOT part of this project. List each such file exactly " +
  "once, in `document_issues`, as a misfiled/example document, and EXCLUDE it " +
  "from every other section (deliverables, notable_changes, difficulties, " +
  "next_steps). Do not let its content colour the project's status. " +
  "Respond only as JSON matching the provided schema.";

// The compact, model-facing payload. Kept small and structured: only the signal
// (one-line summaries, importance, risk flags, non-trivial variance) is sent —
// not the full recap bodies (those already live in the Output folder).
// U12.9 — the contributors to credit for a file's changes, as name+email
// identities: detect's window/all-files revision authors when present, else the
// last modifier. Falls back to the legacy name-only fields (authors/modifiedBy)
// for any AnalyzeFileResult built without `contributors`, so older callers and
// fixtures keep working.
function contributorIdentitiesOf(r: AnalyzeFileResult): ContributorIdentity[] {
  if (r.contributors && r.contributors.length > 0) return r.contributors;
  if (r.authors && r.authors.length > 0)
    return r.authors.map((n) => ({ name: n, email: null }));
  return r.modifiedBy ? [{ name: r.modifiedBy, email: null }] : [];
}

// The labels to credit for a file's changes: each contributor resolved to their
// ORG (mapped) or their name (unmapped), with same-org people collapsed to one.
// An empty map → every contributor resolves to their own name, i.e. exactly the
// previous behaviour.
function labelsFor(r: AnalyzeFileResult, orgMap: OrgMap): string[] {
  return resolveContributorLabels(contributorIdentitiesOf(r), orgMap);
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
// name carries one, else the file's NORMALIZED name. Lets the report show one row
// per deliverable instead of one per EN/IT/pptx copy of the same document.
//
// U1 (eval #16) — no-code names are normalized before keying so the trivial
// variants of one document fold: ".docx" vs "_signed.pdf", trailing spaces,
// case, underscores and accents. 22 CERA-family files rendered as 19 separate
// rows because the key was the raw filename; normalization folds the
// ".pdf/_signed/spacing" variants while leaving genuinely different names
// (e.g. the blank UniGe templates, other projects' files) unmerged.
const FILE_EXT_RX = /\.(g?docx?|pdf|pptx?|xlsx?|gslides?|gsheets?|csv|txt)\s*$/i;
const SIGNED_SUFFIX_RX = /[\s_-]*\(?(signed|firmato)\)?\s*$/i;

export function deliverableKey(name: string | null | undefined): string {
  const n = name ?? "";
  // Match a task (Tx.y) OR deliverable (Dx.y) code, so e.g. "D1.2 — … (with X)"
  // and "D1.2 — … .docx" collapse to one document.
  const m = n.match(/[TD]\d+\.\d+/i);
  if (m) return m[0].toUpperCase();
  const k = n
    .replace(FILE_EXT_RX, "")
    .replace(SIGNED_SUFFIX_RX, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fold diacritics (e-grave -> e)
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
  return k || n;
}

// U1 (eval #10) — a copy whose recap describes an UNFILLED TEMPLATE (skeleton /
// placeholders only). Used as the divergence guard: such a copy must never be
// blended with a substantive copy of the same deliverable into one narrative
// (the D1.3 case: a blank skeleton + an edited copy were unioned into a story
// neither file supports). The substantive override keeps a filled document that
// merely MENTIONS its remaining placeholders (e.g. "fully drafted sections
// alongside template placeholders") out of the template bucket.
const TEMPLATE_RX = /\b(template|placeholder|skeleton|scaffold|blank)\b/i;
const SUBSTANTIVE_RX =
  /\b(fully drafted|highly detailed|highly specific|highly structured|comprehensive|well-structured|detailed)\b/i;

export function looksUnfilledTemplate(
  quality: string | null | undefined,
  summary?: string | null,
): boolean {
  const t = `${quality ?? ""} ${summary ?? ""}`;
  return TEMPLATE_RX.test(t) && !SUBSTANTIVE_RX.test(t);
}

// U7g — `owner` (the file's modified_by label: org or name) rides along so the
// shared-risk hoist can route copied blocks to whoever maintains the files.
type QualityRiskRow = {
  file: string;
  status: string;
  quality: string;
  risks: string[];
  owner?: string;
};
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
  // One folded row from a set of copies. Representative = a non-pptx copy when
  // available; risks = the UNION across the copies (deduped), so a folded copy's
  // verbatim inconsistency catches are never silently dropped (eval M2b/#20 —
  // previously only the representative's risks survived and the others vanished).
  const emit = (set: RawQualityRisk[], suffix: string) => {
    // U7d — a signed/final copy is the best witness for the family's row;
    // fall back to any non-pptx copy, then to whatever is first.
    const rep =
      set.find(
        (e) =>
          (e.status === "final" || e.status === "approved") &&
          !/\.pptx$/i.test(e.rawName),
      ) ??
      set.find((e) => !/\.pptx$/i.test(e.rawName)) ??
      set[0];
    groupRows.push({
      file: `${rep.rawName}${suffix}`,
      status: rep.status,
      quality: rep.quality,
      risks: uniqStrings(set.flatMap((e) => e.risks)),
      // U7g — union the copies' owners so a hoisted shared block can be routed.
      owner:
        uniqStrings(set.map((e) => e.owner ?? "").filter(Boolean)).join(", ") ||
        undefined,
    });
  };
  const foldSuffix = (extra: number) =>
    extra > 0 ? ` (+${extra} more version${extra === 1 ? "" : "s"}: same document)` : "";
  for (const g of groups.values()) {
    // U1 (eval #10) — divergence guard: never fold an unfilled-template copy with
    // a substantive copy into one row; the template copy stays its own, labeled
    // row (U2 collapses template rows into one "not started" line downstream).
    const templates = g.filter((e) => looksUnfilledTemplate(e.quality));
    const filled = g.filter((e) => !templates.includes(e));
    if (templates.length > 0 && filled.length > 0) {
      emit(filled, foldSuffix(filled.length - 1));
      for (const t of templates) emit([t], " (unfilled template copy)");
    } else {
      emit(g, foldSuffix(g.length - 1));
    }
  }
  const rows = [...groupRows, ...supersededRows];
  return { rows, deliverableCount: rows.length };
}

const IMPORTANCE_RANK = { low: 0, medium: 1, high: 2 } as const;
const uniqStrings = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

// U3 (eval B2) — gemini-3.5-flash deterministically transcribes '€' in its INPUT
// as U+2012 (figure dash) in its OUTPUT ("€4-8 million" → "‒4-8 million", which
// reads as negative money). The recaps and the prompt carry a real '€' and the
// HTML/Drive rendering is proven lossless, so the repair happens right after
// generation: a U+2012 immediately followed by a digit can only be the mangled
// euro (real ranges are spaced or use hyphen/en dash). Deep-walks the report.
export function repairCurrency<T>(value: T): T {
  if (typeof value === "string")
    return value.replace(/‒(?=\d)/g, "€") as unknown as T;
  if (Array.isArray(value))
    return value.map((v) => repairCurrency(v)) as unknown as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        repairCurrency(v),
      ]),
    ) as unknown as T;
  return value;
}

// U3 (eval #7) — cap a supporting file's change enumeration in the payload; the
// dropped tail is summarized so the model knows it exists without narrating it.
const capList = (xs: string[], n: number): string[] =>
  xs.length > n ? [...xs.slice(0, n), `(+${xs.length - n} more)`] : xs;

// U7d (eval R4-4) — a document family is "finalized" when any copy is signed
// (by name) or declares itself final/approved (by its own content). Draft
// copies' unresolved placeholders then stop generating next steps: the signed
// version superseded them (the reviewer: "in the files presented this is done").
const SIGNED_NAME_RX = /signed|firmato/i;

// U9a (eval R3-A) — the project lead confirmed the CERA request went draft →
// corrected → signed-and-sent, and the report kept surfacing the DRAFT's open
// items (Mirko's blank role, sample size, committee) as live difficulties. U7d
// already suppresses a draft when a signed copy sits in its OWN family, but the
// token "CERA" splits `arise richiesta parere` (draft) from `arise cera
// richiesta parere` (signed) into different families, so the signal never
// reaches the draft. This detects that cross-family case: a draft family is
// superseded when some SIGNED family's title tokens are a STRICT superset of the
// draft's (the signed doc is the same request, named more fully). Strict-subset
// + a ≥2-token floor keeps it from folding a merely-prefixed neighbour.
export function supersededBySignedKey(
  key: string,
  signedKeys: Set<string>[],
): boolean {
  const kt = key.split(" ").filter(Boolean);
  if (kt.length < 2) return false;
  return signedKeys.some(
    (st) => st.size > kt.length && kt.every((t) => st.has(t)),
  );
}

export function hasSignedFinal(g: AnalyzeFileResult[]): boolean {
  return g.some(
    (r) =>
      SIGNED_NAME_RX.test(r.name ?? "") ||
      r.recap?.file_status === "final" ||
      r.recap?.file_status === "approved",
  );
}

// U2 (eval S2) — pull the unfilled-template rows out of the quality table into a
// single "Not started" list: 7-11 near-identical "blank template / placeholder"
// rows were drowning the real signal. Deterministic, runs after grouping.
export function collapseTemplateRows(rows: QualityRiskRow[]): {
  rows: QualityRiskRow[];
  notStarted: string[];
} {
  // U6 — dedupe display names: two distinct Drive files can share one name
  // (the doubled "Dichiarazione Conflitto Interessi (unfilled template copy)").
  const notStarted = uniqStrings(
    rows.filter((r) => looksUnfilledTemplate(r.quality)).map((r) => r.file),
  );
  return {
    rows: rows.filter((r) => !looksUnfilledTemplate(r.quality)),
    notStarted,
  };
}

// U2 (eval #11/#13/#14/#25) — a risk that recurs across 2+ distinct rows is one
// pasted/shared block, not N independent findings: hoist it to a single
// project-level list (naming the files it appears in) and strip it from the
// per-file cells. The surfaced text stays the first occurrence verbatim.
//
// U8a (eval R4, DPA note) — matching is now FUZZY, not verbatim: the same note
// reworded across documents ("the DPA ... is in corso di formalizzazione",
// phrased three different ways) printed once per copy because exact/whitespace
// matching missed the paraphrases. Two risks merge only when they clear BOTH
// gates — high token overlap (Jaccard) AND several shared significant tokens —
// so a genuinely distinct catch (the reviewer's "good point"), which shares few
// tokens with anything, never merges and is never dropped.
const HOIST_STOP = new Set([
  "the", "a", "an", "of", "to", "and", "or", "is", "are", "in", "on", "for",
  "with", "by", "as", "at", "its", "it", "that", "this", "be", "been", "being",
  "under", "from", "not", "currently", "process", "noted", "which", "was",
  "were", "has", "have", "may", "due",
]);
function hoistTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9àèéìòù]+/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !HOIST_STOP.has(w)),
  );
}
function hoistSimilar(a: Set<string>, b: Set<string>): boolean {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const smaller = Math.min(a.size, b.size);
  // Overlap coefficient (inter / smaller set) — length-tolerant, so a terse
  // rewording of a longer note still matches. Dual gate: most of the shorter
  // risk's vocabulary shared AND at least 4 real tokens in common. Reworded
  // copies of one note clear both; short distinct risks that happen to share a
  // word or two never reach 4 shared tokens.
  const overlap = smaller === 0 ? 0 : inter / smaller;
  return overlap >= 0.6 && inter >= 4;
}
export function hoistSharedRisks(rows: QualityRiskRow[]): {
  rows: QualityRiskRow[];
  shared: Array<{ risk: string; files: string[]; owners: string[] }>;
} {
  type Group = {
    risk: string;
    files: string[];
    owners: string[];
    members: Set<string>;
    tokens: Set<string>;
  };
  const groups: Group[] = [];
  for (const r of rows) {
    for (const risk of r.risks) {
      const t = hoistTokens(risk);
      const g = groups.find(
        (gr) => risk === gr.risk || hoistSimilar(gr.tokens, t),
      );
      if (g) {
        if (!g.files.includes(r.file)) g.files.push(r.file);
        if (r.owner && !g.owners.includes(r.owner)) g.owners.push(r.owner);
        g.members.add(risk);
      } else {
        groups.push({
          risk,
          files: [r.file],
          owners: r.owner ? [r.owner] : [],
          members: new Set([risk]),
          tokens: t,
        });
      }
    }
  }
  const shared = groups.filter((g) => g.files.length >= 2);
  if (shared.length === 0) return { rows, shared: [] };
  const sharedStrings = new Set(shared.flatMap((g) => Array.from(g.members)));
  return {
    rows: rows.map((r) => ({
      ...r,
      risks: r.risks.filter((risk) => !sharedStrings.has(risk)),
    })),
    shared: shared.map(({ risk, files, owners }) => ({ risk, files, owners })),
  };
}

// Collapse the format/language copies of one document (same deliverableKey) into
// ONE payload entry, so the model's new_or_changed_files reports e.g. D1.2 once,
// not once per .docx/.gdoc copy. Superseded (old-generation) files NEVER fold
// into the current document — each stays its own entry, mirroring groupByDeliverable.
function buildChangedFiles(analyzed: AnalyzeFileResult[], orgMap: OrgMap) {
  const groups = new Map<string, AnalyzeFileResult[]>();
  const superseded: AnalyzeFileResult[] = [];
  for (const r of analyzed) {
    if (looksSuperseded(r.name, r.folderPath)) {
      superseded.push(r);
      continue;
    }
    const key = deliverableKey(r.name);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const entry = (
    g: AnalyzeFileResult[],
    isSuperseded: boolean,
    suffix?: string,
    familyDeliverable?: boolean,
    familySignedFinal?: boolean,
  ) => {
    const rep = g.find((r) => !/\.pptx$/i.test(r.name ?? "")) ?? g[0];
    const extra = g.length - 1;
    const recaps = g.map((r) => r.recap!);
    // U7f — the deliverable flag belongs to the FAMILY, not the copy: the linked
    // gdoc shell carries it while the content lives in the .docx sibling, so a
    // divergence split used to strip the flag off the content entry (making the
    // report claim "all deliverables are empty templates"). The caller passes
    // the whole-group flag when splitting.
    const isDeliverable =
      familyDeliverable ?? recaps.some((r) => r.is_deliverable);
    // U3 (eval #7) — a supporting file's change lists are capped (the model gets
    // the gist + a "+N more" marker), so References/Contatti-class files stop
    // getting deliverable-level enumeration. Deliverables keep the full lists;
    // risk_flags are NEVER capped (they carry the verbatim inconsistency catches).
    const capped = (xs: string[]) => (isDeliverable ? xs : capList(xs, 2));
    return {
      // U12.8 — reference by human name, noting how many copies were folded.
      file:
        suffix !== undefined
          ? `${rep.name ?? rep.fileId}${suffix}`
          : extra > 0
            ? `${rep.name ?? rep.fileId} (+${extra} more version${extra === 1 ? "" : "s"}: same document)`
            : (rep.name ?? rep.fileId),
      summary: uniqStrings(recaps.map((r) => r.one_line_summary)).join(" "),
      importance: recaps.reduce<"low" | "medium" | "high">(
        (a, r) => (IMPORTANCE_RANK[r.importance] > IMPORTANCE_RANK[a] ? r.importance : a),
        "low",
      ),
      is_deliverable: isDeliverable,
      // U5 (revision delta) — when non-null, this entry's additions/edits come
      // from a COMPUTED DIFF against the file's revision at this date (verified
      // changes); null → the recap describes current content only.
      changes_verified_since:
        g
          .map((r) => r.deltaBaseDate)
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null,
      // U4 (eval #6/R2) — the grounded dates for {claim, file, date} citations:
      // newest Drive modifiedTime across the folded copies (date only), a leading
      // YYYYMMDD in the filename (the kick-off deck case), and the documents' own
      // stated event dates from the recaps.
      last_modified:
        g
          .map((r) => r.modifiedTime)
          .filter((t): t is string => !!t)
          .sort()
          .pop()
          ?.slice(0, 10) ?? null,
      ...(() => {
        const m = (rep.name ?? "").match(/^(\d{4})(\d{2})(\d{2})\b/);
        return m ? { filename_date: `${m[1]}-${m[2]}-${m[3]}` } : {};
      })(),
      key_dates: uniqStrings(recaps.flatMap((r) => r.key_dates ?? [])),
      additions: capped(uniqStrings(recaps.flatMap((r) => r.additions))),
      edits: capped(uniqStrings(recaps.flatMap((r) => r.edits))),
      structural_changes: capped(
        uniqStrings(recaps.flatMap((r) => r.structural_changes)),
      ),
      risk_flags: uniqStrings(recaps.flatMap((r) => r.risk_flags)),
      // U12.9 — org (mapped) or name (unmapped) of every contributor across the
      // folded copies, deduped. Never a raw person's name once mapped.
      modified_by: uniqStrings(g.flatMap((r) => labelsFor(r, orgMap))).join(", ") || "unknown",
      looks_superseded: isSuperseded,
      // U2 (eval S2) — every copy behind this entry is an unfilled template →
      // the model is told to report it only inside one collective sentence.
      is_empty_template: g.every((r) =>
        looksUnfilledTemplate(r.recap?.quality_judgment, r.recap?.one_line_summary),
      ),
      // U7d (eval R4-4) — the family contains a signed or final/approved copy:
      // draft copies' placeholders and open comments are HISTORY, not work. The
      // model is told never to derive next steps or difficulties from them.
      has_signed_final: familySignedFinal ?? hasSignedFinal(g),
    };
  };
  const foldSuffix = (extra: number) =>
    extra > 0 ? ` (+${extra} more version${extra === 1 ? "" : "s"}: same document)` : "";
  // U9a — token sets of every family that already holds a signed/final copy, so a
  // draft family split off by a stray title word (the "CERA" case) can still learn
  // that its final exists and mark its open items as history.
  const signedKeys: Set<string>[] = [];
  for (const [key, g] of groups) {
    if (hasSignedFinal(g)) signedKeys.push(new Set(key.split(" ").filter(Boolean)));
  }
  const out: ReturnType<typeof entry>[] = [];
  for (const [key, g] of groups) {
    // A signed final in a differently-named family supersedes this draft too.
    const crossSigned = hasSignedFinal(g) || supersededBySignedKey(key, signedKeys);
    // U1 (eval #10/R1) — divergence guard, mirroring groupByDeliverable: when a
    // deliverable's copies split into unfilled templates and substantive content
    // (the D1.3 case: a blank skeleton + a test-edited copy), do NOT union them
    // into one confident narrative neither copy supports. The substantive copies
    // fold together; each template copy stays a separate, labeled entry so the
    // model reports it as an unfilled template, not as authored progress.
    const templates = g.filter((r) =>
      looksUnfilledTemplate(r.recap?.quality_judgment, r.recap?.one_line_summary),
    );
    const filled = g.filter((r) => !templates.includes(r));
    if (templates.length > 0 && filled.length > 0) {
      // U7f/U7d/U9a — split entries inherit the whole family's flags.
      const familyDeliverable = g.some((r) => r.recap!.is_deliverable);
      out.push(
        entry(filled, false, foldSuffix(filled.length - 1), familyDeliverable, crossSigned),
      );
      for (const t of templates)
        out.push(
          entry([t], false, " (unfilled template copy)", familyDeliverable, crossSigned),
        );
    } else {
      // U9a — pass the cross-family signed flag (default path used hasSignedFinal(g)
      // only, which the CERA split defeated).
      out.push(entry(g, false, undefined, undefined, crossSigned));
    }
  }
  return [...out, ...superseded.map((r) => entry([r], true))];
}

function buildPayload(
  input: SynthesizeInput,
  variance: VarianceResult | null,
  period: string | null,
  orgMap: OrgMap,
) {
  const analyzed = input.fileResults.filter((r) => r.status === "analyzed" && r.recap);
  const missed = input.fileResults.filter((r) => r.status === "error");

  return {
    run: input.runLabel,
    reporting_period: period,
    changed_since_last_report: input.changedSince ?? [],
    changed_files: buildChangedFiles(analyzed, orgMap),
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
  orgMap: OrgMap,
): string {
  const payload = buildPayload(input, variance, period, orgMap);
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
    // 0143 — verbosity directive ('medium' → "") + the owner's standing focus
    // (emphasis-only, guarded so it can't override grounding/scope/attribution).
    lengthDirective(input.reportLength ?? "medium") +
    customFocusDirective(input.customPrompt) +
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
  // U2 — risks found verbatim in 2+ documents, hoisted out of the per-file rows
  // (likely one pasted/shared block, not N independent findings). U7g — they now
  // render as Document-issues rows, routed to the copies' owners.
  sharedRisks?: Array<{ risk: string; files: string[]; owners?: string[] }> | null;
  // U2 — unfilled-template files pulled out of the table into one "Not started"
  // line. Absent/empty → byte-identical to before this field existed.
  notStartedFiles?: string[] | null;
  // U7g — deterministic document defects computed by the pipeline (unreadable
  // files etc.), merged into the Document-issues section ahead of the model's.
  fileDefects?: DocumentIssue[] | null;
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
    // document, prefix the distinct-document count: "33 documents · 41 files". Said
    // "documents" not "deliverables" — most files aren't grant deliverables. Only
    // when grouping actually collapses something (D < N); absent/equal → just files.
    const showGroups =
      deliverableCount != null && deliverableCount < counts.changed;
    const fileWord = counts.changed === 1 ? "file" : "files";
    meta.push([
      "Changes",
      (showGroups
        ? `${deliverableCount} document${deliverableCount === 1 ? "" : "s"} · `
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
  // U7c (eval R4-3, "what do you mean missed updates") — the section opens with
  // a plain-language explainer so a non-engineer knows what the list means.
  const missedUpdates =
    report.missed_updates.length > 0
      ? paragraph(
          "These files could not be read or analysed on this run, so their content is NOT reflected in this report. Temporary failures usually resolve on the next run; a file that appears here repeatedly is listed under Document issues for its owner.",
        ) + bullets(report.missed_updates.map(fmt))
      : counts
        ? paragraph(
            counts.changed === 0
              ? "No files were analysed this run."
              : `All ${counts.changed} analysed file${counts.changed === 1 ? "" : "s"} were read successfully — no missed updates.`,
          )
        : bullets([]);

  // Difficulties as a table carrying a grounded severity badge (#8). Empty →
  // "(none)", byte-identical to the previous bullet rendering when there are none.
  // U4 (eval #18) — each row shows the document it comes from when the model
  // supplied one, so every difficulty is traceable to a source.
  const difficulties =
    report.difficulties.length === 0
      ? paragraph("(none)")
      : table(
          ["Difficulty", "Severity"],
          report.difficulties.map((d) => [
            fmt(d.description) +
              (d.source_file ? ` <i>(${fmt(d.source_file)})</i>` : ""),
            monoCell(d.severity),
          ]),
        );

  // U4 (eval #6/R2) — notable changes render as cited claims: "claim (file, date)".
  const notableChanges = report.notable_changes.map((n) =>
    fmt(n.claim) +
    (n.file
      ? ` <i>(${fmt(n.file)}${n.date ? `, ${escapeHtml(n.date)}` : ""})</i>`
      : ""),
  );

  // Per-file quality + risk table (deterministic — straight from each file's
  // recap, never re-narrated). Empty risks → "—"; no analyzed files → "(none)".
  // U2 — shared risks render once above the table; template files render as one
  // "Not started" line below it instead of one near-identical row each.
  const qr = input.qualityRisks ?? [];
  const shared = input.sharedRisks ?? [];
  const notStarted = input.notStartedFiles ?? [];
  const notStartedBlock =
    notStarted.length > 0
      ? paragraph(
          `Not started (unfilled templates): ${notStarted.map(fmt).join(" · ")}`,
        )
      : "";
  const qualityRisks =
    qr.length === 0 && notStarted.length === 0
      ? paragraph("(none)")
      : (qr.length > 0
          ? table(
              ["File", "Status", "Quality", "Risks"],
              qr.map((r) => [
                fmt(r.file),
                monoCell(r.status || "unknown"),
                r.quality ? escapeHtml(r.quality) : "—",
                r.risks.length > 0 ? r.risks.map(escapeHtml).join("<br>") : "—",
              ]),
            )
          : "") + notStartedBlock;

  // U7g — the routing section: one table of document defects, each row aimed at
  // whoever maintains the file. Deterministic rows first (copied blocks found by
  // the verbatim hoist, unreadable files), then the model's findings. The
  // section is self-clearing: a fixed document stops producing its row on the
  // next run.
  const issueRows: DocumentIssue[] = [
    ...shared.map((s) => ({
      issue: `Identical text found verbatim in several documents (likely one copied block, not independent content): ${s.risk}`,
      files: s.files.join("; "),
      owner: uniqStrings(s.owners ?? []).join(", ") || "unknown",
      severity: "medium" as const,
    })),
    ...(input.fileDefects ?? []),
    ...report.document_issues,
  ];
  const documentIssues =
    issueRows.length === 0
      ? paragraph("(none — no document defects detected this run)")
      : paragraph(
          "Defects of the documents themselves, for their owners to fix — distinct from project difficulties. A fixed document drops off this list automatically on the next run.",
        ) +
        table(
          ["Issue", "Document(s)", "Owner", "Severity"],
          issueRows.map((i) => [
            fmt(i.issue),
            fmt(i.files),
            fmt(i.owner || "unknown"),
            monoCell(i.severity),
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
    notable_changes: section("Notable changes") + bullets(notableChanges),
    new_or_changed_files:
      section("New or changed files") + bullets(report.new_or_changed_files.map(fmt)),
    missed_updates: section("Missed updates") + missedUpdates,
    deviations: section("Deviations from the approved baseline") + deviations,
    quality_risks: section("Quality and risks") + qualityRisks,
    progress_notes:
      section("Progress notes") + bullets(report.progress_notes.map(fmt)),
    difficulties: section("Difficulties") + difficulties,
    document_issues: section("Document issues") + documentIssues,
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

  // Compile the contributor → org lookup once for the whole run. Empty map →
  // every contributor resolves to their own name (pre-feature behaviour).
  const orgMap = buildOrgMap(input.contributorOrgs ?? []);

  // U3 (eval B2) — repair the model's deterministic '€'→U+2012 transcription
  // right at the source, so both the rendered Doc and the returned report carry
  // the real euro sign.
  const report = repairCurrency(
    await generateStructured<SynthesisReport>({
      model: "gemini-3.5-flash",
      systemInstruction: SYNTHESIS_SYSTEM,
      prompt: buildPrompt(input, variance, period, orgMap),
      responseSchema: REPORT_SCHEMA,
      temperature: 0,
    }),
  );

  // U12.6/U12.9 — the grounded set of labels to bold in the rendered report:
  // every contributor to an analyzed file, resolved to their org (mapped) or name
  // (unmapped). Bolding the resolved label keeps it consistent with the payload.
  const authors = Array.from(
    new Set(
      input.fileResults
        .filter((r) => r.status === "analyzed")
        .flatMap((r) => labelsFor(r, orgMap))
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
      // U7g — the owner label (org or name) rides along for issue routing.
      owner: labelsFor(r, orgMap).join(", ") || undefined,
    }));
  const { rows: groupedRows, deliverableCount } =
    groupByDeliverable(rawQualityRisks);
  // U2 (eval S2 + #25) — deterministic noise reduction on the grouped rows:
  // template skeletons collapse to one "Not started" line, then risks recurring
  // verbatim across documents hoist to one project-level list.
  const { rows: activeRows, notStarted } = collapseTemplateRows(groupedRows);
  const { rows: qualityRisks, shared: sharedRisks } = hoistSharedRisks(activeRows);

  // U7g — deterministic document defects: a file whose CONTENT is broken (not a
  // transient read error) is the owner's problem, routed via Document issues.
  // Transient failures (timeouts, rate limits) stay in Missed updates only.
  const FILE_DEFECT_RX = /not supported|not a zip|corrupt|password|encrypted/i;
  const fileDefects: DocumentIssue[] = input.fileResults
    .filter((r) => r.status === "error" && FILE_DEFECT_RX.test(r.error ?? ""))
    .map((r) => ({
      issue:
        "File cannot be read by the analysis (its format/content appears broken) — fix or remove it.",
      files: r.name ?? r.fileId,
      owner: labelsFor(r, orgMap).join(", ") || "unknown",
      severity: "medium" as const,
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
    sharedRisks,
    notStartedFiles: notStarted,
    fileDefects,
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
