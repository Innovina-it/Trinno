import "server-only";

import { Type } from "@google/genai";
import type { Schema } from "@google/genai";

import { exportText } from "./clients/drive";
import { generateStructured } from "./clients/gemini";
import { getRegistryEntry } from "./registry";
import type { DetectedFile } from "./detect";

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
};

export type AnalyzeFileResult = {
  fileId: string;
  version: string | null;
  status: AnalyzeStatus;
  recapFileId: string | null;
  recap: FileRecap | null;
  error: string | null;
};

export type AnalyzeInput = {
  workspaceId: string;
  outputFolderId: string;
  // The full detect() output; this unit filters to editable changes itself.
  files: DetectedFile[];
};

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
  ],
};

const RECAP_SYSTEM =
  "You are a project-management analyst. Given the current text of a project " +
  "document, produce a concise, factual recap of what the document covers and " +
  "what appears to have changed. Be specific and terse; do not invent content " +
  "that is not present. Respond only as JSON matching the provided schema.";

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
  for (const file of editable) {
    // Drive `version` is the gate key — headRevisionId is null for Google docs.
    const version = file.version;
    try {
      // ── Gate C: skip if we've already analysed this exact version.
      const entry = await getRegistryEntry(input.workspaceId, file.fileId);
      const lastVersion = lastVersionOf(entry);
      if (version && lastVersion && lastVersion === version) {
        results.push({
          fileId: file.fileId,
          version,
          status: "skipped",
          recapFileId: null,
          recap: null,
          error: null,
        });
        continue;
      }

      // ── Step D: export → Flash recap → write recap JSON to OUTPUT.
      const content = await exportText(file.fileId, file.mimeType ?? "");
      const recap = await generateStructured<FileRecap>({
        model: "gemini-2.5-flash",
        systemInstruction: RECAP_SYSTEM,
        prompt: buildPrompt(file, content),
        responseSchema: RECAP_SCHEMA,
        temperature: 0,
      });
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
      });
    } catch (err) {
      results.push({
        fileId: file.fileId,
        version,
        status: "error",
        recapFileId: null,
        recap: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
