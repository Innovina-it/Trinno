import "server-only";

import { Type } from "@google/genai";
import type { Schema } from "@google/genai";

import { getAnalyzableContent, getAnalyzableTextBefore } from "./content";
import { generateStructured } from "./clients/gemini";
import { diffLines } from "./text-diff";
import { withTimeout } from "./with-timeout";
import { getRegistryEntry } from "./registry";
import type { DetectedFile } from "./detect";
import type { ContributorIdentity } from "./contributor-orgs";

// PMA U6 — VERSION GATE (DESIGN §3 C) + ANALYZE (D).
//
// For each EDITABLE changed file from detect(): a cheap registry lookup gates
// out files we've already analysed at this exact version, then the remaining
// files are exported to text and recapped by Gemini Flash. The structured recap
// rides back in-memory; U12.1 persists it to pma_file_registry.recap_json (via
// reconcile) instead of writing a recaps/{fileId}__{version}.json file to Drive.
//
// SCOPE BOUNDARIES (DESIGN §1, §3):
//  - READS the registry (version gate) but NEVER writes it — registry
//    persistence is U8 reconcile / U9 orchestration (step G).
//  - Touches NO Drive write path (U12.1 removed the recap write). Reads Source
//    content via exportText only; never writes the Source folder.
//  - Non-editable + removed files never reach Gemini (filtered out here).
//  - A single file's failure becomes status=error ("missed update") and never
//    aborts the batch.
//
// The deliverable flag on the recap is taken from detect()'s authoritative
// links cross-ref, not from the model's guess.

export type AnalyzeStatus = "analyzed" | "skipped" | "error";

// Structured per-file recap (DESIGN §5.1).
export type FileRecap = {
  additions: string[];
  edits: string[];
  structural_changes: string[];
  one_line_summary: string;
  recap: string[];
  quality_judgment: string;
  importance: "low" | "medium" | "high";
  risk_flags: string[];
  is_deliverable: boolean;
  // Maturity of the document, inferred from its own content/labels (never the
  // model's guess): "unknown" when the document does not state it.
  file_status: "draft" | "final" | "approved" | "unknown";
  // U4 (eval #2/#15) — explicit dates of key events the document itself states
  // (kick-off, submission, signature, deadline), each "event — date" verbatim.
  // Optional in the type so pre-U4 recaps stored in recap_json stay valid.
  key_dates?: string[];
};

export type AnalyzeFileResult = {
  fileId: string;
  version: string | null;
  status: AnalyzeStatus;
  recapFileId: string | null;
  recap: FileRecap | null;
  error: string | null;
  // U4 (eval #6/R2) — the file's Drive modifiedTime, carried from detect so the
  // synthesis payload can date every change claim ({claim, file, date}).
  modifiedTime?: string | null;
  // U5 (revision delta) — when the recap was grounded in a computed diff, the
  // date of the old revision it was diffed against; null/absent → the recap
  // describes current content only (no verified change basis).
  deltaBaseDate?: string | null;
  // U12.4 — displayName of the file's last modifier (or null/"unknown"); surfaced
  // in the report for attribution. Not persisted in recap_json.
  modifiedBy?: string | null;
  // U12.8 — the file's human name, so the report references it by name instead of
  // the raw Drive fileId.
  name?: string | null;
  // U12.9 — the people who revised the file within the run's window (per-period
  // attribution). Supersedes the single modifiedBy when present.
  authors?: string[];
  // Name+email identities for the same contributors, carried from detect. The
  // synthesis org resolver matches these to organizations; parallel to authors,
  // which stays as the raw display-name list.
  contributors?: ContributorIdentity[];
  // #4 — source-relative ancestor folder names, carried from detect so synthesize
  // can flag files under a superseded folder (e.g. "First Output (old)").
  folderPath?: string[];
};

export type AnalyzeInput = {
  workspaceId: string;
  outputFolderId: string;
  // The full detect() output; this unit filters to editable changes itself.
  files: DetectedFile[];
  // U12.9 — window mode: BYPASS the version gate so a chosen period is always
  // (re)reported, regardless of whether the file's current version was analysed
  // before. detect's revision-based membership already scoped the file set.
  windowed?: boolean;
  // U5 (revision delta) — the window's start (ISO). When present, each native
  // Google Doc's recap is grounded in a COMPUTED DIFF between the newest
  // revision at-or-before this instant and the current text, so "what changed"
  // is verified instead of inferred. Best-effort per file; absent → unchanged.
  windowStart?: string | null;
  // 0145 (run manager) — optional cooperative hooks. onProgress is called after
  // each editable file settles, with 1-based done / total, so the run row can
  // show "analyzing N/M". shouldCancel is polled before each file; returning true
  // stops the loop early (partial results returned; the orchestrator finalizes as
  // 'cancelled'). Both absent → today's behaviour, no DB traffic.
  onProgress?: (done: number, total: number) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
};

// U12.9 — who to attribute a file's changes to: the window's revision authors if
// detect provided them, else the single last modifier, else nobody (→ "non noto").
function authorsOf(file: DetectedFile): string[] {
  if (file.windowAuthors && file.windowAuthors.length > 0) return file.windowAuthors;
  return file.lastModifiedBy ? [file.lastModifiedBy] : [];
}

// Same set as authorsOf, but as name+email identities for org resolution. detect
// populates contributors in every mode; fall back to the last modifier (no email)
// for any DetectedFile built without it.
function contributorsOf(file: DetectedFile): ContributorIdentity[] {
  if (file.contributors && file.contributors.length > 0) return file.contributors;
  return file.lastModifiedBy ? [{ name: file.lastModifiedBy, email: null }] : [];
}

const RECAP_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    additions: { type: Type.ARRAY, items: { type: Type.STRING } },
    edits: { type: Type.ARRAY, items: { type: Type.STRING } },
    structural_changes: { type: Type.ARRAY, items: { type: Type.STRING } },
    one_line_summary: { type: Type.STRING },
    recap: { type: Type.ARRAY, items: { type: Type.STRING } },
    quality_judgment: { type: Type.STRING },
    importance: { type: Type.STRING, enum: ["low", "medium", "high"] },
    risk_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
    is_deliverable: { type: Type.BOOLEAN },
    file_status: {
      type: Type.STRING,
      enum: ["draft", "final", "approved", "unknown"],
    },
    key_dates: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "additions",
    "edits",
    "structural_changes",
    "one_line_summary",
    "recap",
    "quality_judgment",
    "importance",
    "risk_flags",
    "is_deliverable",
    "file_status",
    "key_dates",
  ],
};

const RECAP_SYSTEM =
  "You are a project-management analyst. Given the current text of a project " +
  "document, produce a concise, factual recap of what the document covers and " +
  "what appears to have changed. Be specific and terse; do not invent content " +
  "that is not present. Never state a number, measurement, duration, percentage " +
  "or standard/regulation code (e.g. an IEC/ISO/EN number, a GDPR or AI Act " +
  "article) that does not appear verbatim in this document; do not import figures " +
  "from prior knowledge or other reports. When the document names a regulation or " +
  "standard, keep its identifier exact and complete, and never drop a member of a " +
  "set the document cites together (e.g. GDPR + AI Act + Workers' Statute Art. 4). " +
  "Set `file_status` to the document's own declared maturity — draft, final or " +
  "approved — read from its content or labels; use \"unknown\" when the document " +
  "does not state it. Never guess the status. " +
  // U6 — one language: recap fields drifted into the source document's language.
  "Write every field in English regardless of the document's language, quoting " +
  "non-English titles or phrases verbatim only where exactness matters. " +
  // U4 (eval #2/#15) — dates become machine-usable so the report can anchor
  // events ("kicked off on 12/06/2026") instead of leaving them unplaced.
  "Extract `key_dates`: the explicit dates of key events the document itself " +
  "states (kick-off, submission, signature, approval, deadline, project " +
  "start/end), each item as 'event — date' quoting the date verbatim; [] when " +
  "the document states none. " +
  // U4 (eval #24/S4) — risk flags must be live concerns, not chapter topics.
  "`risk_flags` are the current, open concerns THIS document raises about the " +
  "project's own execution; never list risk TOPICS merely discussed in a " +
  "market-analysis or business-plan chapter, and never content that reads as " +
  "boilerplate pasted from another document. " +
  // U4 (eval #5/I2) — pre-printed template scaffolding is not authored work.
  "Standard template scaffolding (pre-printed header fields like task lead or " +
  "partner list, section placeholders, instructions) is NOT authored progress: " +
  "describe such a document as an unfilled template rather than narrating its " +
  "scaffolding as additions. " +
  // U5 (revision delta) — when a real diff is supplied, changes are VERIFIED;
  // without one, never claim to know what changed.
  "When the input includes a VERIFIED CHANGES block (a computed diff against an " +
  "earlier revision), ground `additions`, `edits` and `structural_changes` " +
  "EXCLUSIVELY in that diff — those are the real changes since the stated date; " +
  "the full text above it is context for understanding the diff. When no such " +
  "block is present, you cannot know what changed: describe the CURRENT content " +
  "and do not phrase anything as having been added or changed. " +
  "Respond only as JSON matching the provided schema.";

function buildPrompt(file: DetectedFile, content: string): string {
  const header =
    `Document: ${file.name ?? file.fileId}\n` +
    `Deliverable: ${file.isDeliverable ? "yes" : "no"}\n` +
    `--- CONTENT START ---\n`;
  return `${header}${content}\n--- CONTENT END ---`;
}

// The registry row arrives from supabase-js in snake_case at runtime even though
// its TS type (PmaFileRegistryRow) is camelCase. Read defensively so the gate is
// correct regardless. (Flagged for U8, which owns registry writes.)
function lastVersionOf(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const v = row.last_version ?? row.lastVersion;
  return typeof v === "string" ? v : null;
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeFileResult[]> {
  const editable = input.files.filter(
    (f) => f.kind === "editable" && f.changeType === "added_or_edited",
  );

  const results: AnalyzeFileResult[] = [];
  const total = editable.length;
  let done = 0;
  for (const file of editable) {
    // 0145 — cooperative cancel: stop before starting another file's work. The
    // orchestrator re-checks the flag and finalizes the run as 'cancelled'.
    if (input.shouldCancel && (await input.shouldCancel())) break;
    // Drive `version` is the gate key — headRevisionId is null for Google docs.
    const version = file.version;
    try {
      // ── Gate C: skip if we've already analysed this exact version. BYPASSED in
      //    window mode (U12.9) — a chosen period must always (re)report its files.
      const entry = input.windowed
        ? null
        : await getRegistryEntry(input.workspaceId, file.fileId);
      const lastVersion = lastVersionOf(entry);
      if (!input.windowed && version && lastVersion && lastVersion === version) {
        results.push({
          fileId: file.fileId,
          version,
          status: "skipped",
          recapFileId: null,
          recap: null,
          error: null,
          modifiedBy: file.lastModifiedBy,
          modifiedTime: file.modifiedTime,
          name: file.name,
          authors: authorsOf(file),
          contributors: contributorsOf(file),
          folderPath: file.folderPath,
        });
        done += 1;
        await input.onProgress?.(done, total);
        continue;
      }

      // ── Step D: fetch content (text export, or a binary file part for
      //    PDF/images/Office) → Flash recap. The recap body rides back in-memory.
      //    U6c — every await is timeout-guarded: a hung call becomes THIS file's
      //    error (a missed update), never a frozen run.
      const label = file.name ?? file.fileId;
      const analyzable = await withTimeout(
        getAnalyzableContent(file.fileId, file.mimeType ?? ""),
        90_000,
        `content export for "${label}"`,
      );

      // U5 (revision delta) — for a windowed run, ground "what changed" in a
      // computed diff against the newest revision at-or-before the window start.
      // Best-effort: any miss leaves deltaBlock empty and the recap describes
      // current content (the prompt tells the model which mode it is in).
      let deltaBlock = "";
      let deltaBaseDate: string | null = null;
      if (input.windowStart && "text" in analyzable) {
        // Best-effort stays best-effort under a timeout too: a slow revision
        // read degrades to "no verified delta", never an error.
        const before = await withTimeout(
          getAnalyzableTextBefore(file.fileId, file.mimeType ?? "", input.windowStart),
          30_000,
          `revision history for "${label}"`,
        ).catch(() => null);
        if (before) {
          deltaBaseDate = before.revisionDate;
          const d = diffLines(before.text, analyzable.text);
          deltaBlock =
            d.added + d.removed > 0
              ? `\n--- VERIFIED CHANGES SINCE ${before.revisionDate} (computed diff vs that revision: +${d.added}/-${d.removed} lines${d.truncated ? ", truncated" : ""}) ---\n${d.text}\n--- END VERIFIED CHANGES ---`
              : `\n--- VERIFIED CHANGES SINCE ${before.revisionDate}: none — content is identical to that revision ---`;
        }
      }

      const recap = await withTimeout(
        generateStructured<FileRecap>({
          model: "gemini-3.5-flash",
          systemInstruction: RECAP_SYSTEM,
          prompt:
            buildPrompt(
              file,
              "text" in analyzable ? analyzable.text : "(binary document attached below)",
            ) + deltaBlock,
          responseSchema: RECAP_SCHEMA,
          temperature: 0,
          ...("file" in analyzable ? { files: [analyzable.file] } : {}),
        }),
        150_000,
        `recap generation for "${label}"`,
      );
      // detect()'s links cross-ref is authoritative — not the model's guess.
      recap.is_deliverable = file.isDeliverable;

      results.push({
        fileId: file.fileId,
        version,
        status: "analyzed",
        // U12.1 — the recap body is no longer written to Drive here; it rides
        // back in-memory and reconcile persists it to recap_json.
        recapFileId: null,
        recap,
        error: null,
        deltaBaseDate,
        modifiedBy: file.lastModifiedBy,
        modifiedTime: file.modifiedTime,
        name: file.name,
        authors: authorsOf(file),
        contributors: contributorsOf(file),
        folderPath: file.folderPath,
      });
    } catch (err) {
      results.push({
        fileId: file.fileId,
        version,
        status: "error",
        recapFileId: null,
        recap: null,
        error: err instanceof Error ? err.message : String(err),
        modifiedBy: file.lastModifiedBy,
        modifiedTime: file.modifiedTime,
        name: file.name,
        authors: authorsOf(file),
        contributors: contributorsOf(file),
        folderPath: file.folderPath,
      });
    }
    done += 1;
    await input.onProgress?.(done, total);
  }
  return results;
}
