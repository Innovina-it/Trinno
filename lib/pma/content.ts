import "server-only";

import {
  exportText,
  getFileBytes,
  copyAsGoogleAndExportText,
  getNativeRevisionTextBefore,
} from "@/lib/pma/clients/drive";

// Which Drive mime types the analyzer can read, and how. Three families:
//  - Google-native (Docs/Sheets/Slides): export to text.
//  - Binary-native (PDF, common images): Gemini reads the bytes directly.
//  - Office (docx/xlsx/pptx): convert via Drive to a Google type, then export text.
const GOOGLE_NATIVE = new Set<string>([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);
const BINARY_NATIVE = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const OFFICE = new Set<string>([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// True if the analyzer can read this type's content (used by detect.categorize).
export function isAnalyzable(mimeType: string): boolean {
  return GOOGLE_NATIVE.has(mimeType) || BINARY_NATIVE.has(mimeType) || OFFICE.has(mimeType);
}

// Either extracted text (fed into the recap prompt) or a binary file part (sent
// to Gemini as multimodal input alongside the prompt).
export type AnalyzableContent =
  | { text: string }
  | { file: { mimeType: string; data: string } };

// Fetch a file's content in the form the recap step needs. Throws for types that
// isAnalyzable() rejects, so callers never silently feed an unsupported file.
export async function getAnalyzableContent(
  fileId: string,
  mimeType: string,
): Promise<AnalyzableContent> {
  if (GOOGLE_NATIVE.has(mimeType)) return { text: await exportText(fileId, mimeType) };
  if (OFFICE.has(mimeType)) return { text: await copyAsGoogleAndExportText(fileId, mimeType) };
  if (BINARY_NATIVE.has(mimeType)) {
    const f = await getFileBytes(fileId);
    return { file: { mimeType: f.mimeType, data: f.data } };
  }
  throw new Error(`getAnalyzableContent: ${mimeType} is not analyzable`);
}

// U5 (revision delta) — the file's text as it stood at the newest revision
// at-or-before `beforeIso`, so analyze can diff it against the current text and
// feed the recap a VERIFIED change instead of an inferred one. v1 covers native
// Google Docs only (their revisions export directly; an old Office/PDF revision
// would need a convert-upload round-trip — deferred). Best-effort by contract:
// any miss (no old revision, no export link, Drive error) returns null and the
// caller falls back to current-content behaviour.
export async function getAnalyzableTextBefore(
  fileId: string,
  mimeType: string,
  beforeIso: string,
): Promise<{ text: string; revisionDate: string } | null> {
  if (!GOOGLE_NATIVE.has(mimeType)) return null;
  try {
    return await getNativeRevisionTextBefore(fileId, beforeIso);
  } catch {
    return null;
  }
}
