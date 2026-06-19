import "server-only";

import { Type } from "@google/genai";
import type { Schema } from "@google/genai";

import {
  listFolder,
  listFolderTree,
  getFileBytes,
  uploadFile,
  trashFile,
} from "@/lib/pma/clients/drive";
import { generateStructured } from "./clients/gemini";
import { getAnalyzableContent, isAnalyzable } from "./content";

// PMA — PROJECT CONTEXT (background docs the analysis is grounded in).
//
// A "Context" folder lives INSIDE the Source/Documents folder (created at setup by
// provision / pma-folders). The analysis SCAN skips it (detect's skipNames), so its
// files are never detected, recapped, version-tracked, or counted — they are read
// ONLY here and injected into the synthesis prompt as project background.
//
// Two readers:
//   getProjectContext — the RAW concatenated text (text-only; PDF/image skipped;
//     a single unreadable file is skipped, never fatal; capped at MAX_CONTEXT_CHARS).
//   getProjectBrief   — a DISTILLED, cached brief. Instead of re-sending the raw
//     dump to the model every run, the raw text is distilled once into a tight
//     brief and cached as a JSON file in the OUTPUT (Reports) folder, keyed by a
//     {fileId: driveVersion} fingerprint of the Context files. Later runs reuse the
//     brief until Context changes; then it re-distills. Best-effort throughout: any
//     cache or distill failure falls back to the raw text, never failing the run.
// Both return null when there is no Context folder or it yields no text — the run
// is then byte-identical to before.

const CONTEXT_FOLDER_NAME = "Context";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// The cached-brief file, written into the OUTPUT (Reports) folder — never scanned,
// and the one tree the run is allowed to write.
const BRIEF_CACHE_NAME = "_context-brief.json";

// Cap the concatenated raw context so a large folder can't blow up the prompt
// (the fallback path) or the distillation input.
export const MAX_CONTEXT_CHARS = 100_000;

type GatheredContext = {
  text: string;
  // {fileId: driveVersion} of the files that contributed text — the cache key.
  fingerprint: Record<string, string>;
};

// Read the Context folder into concatenated text + a fingerprint of the
// contributing files. Returns null when there is no Context folder or no text.
async function gatherContext(sourceFolderId: string): Promise<GatheredContext | null> {
  const children = await listFolder(sourceFolderId);
  const contextFolder = children.find(
    (f) => f.mimeType === FOLDER_MIME && f.name === CONTEXT_FOLDER_NAME,
  );
  if (!contextFolder) return null;

  const files = await listFolderTree(contextFolder.id);

  const sections: string[] = [];
  const fingerprint: Record<string, string> = {};
  let total = 0;
  for (const f of files) {
    if (!f.mimeType || !isAnalyzable(f.mimeType)) continue;
    let text: string;
    try {
      const content = await getAnalyzableContent(f.id, f.mimeType);
      if (!("text" in content)) continue; // skip binary (PDF/image) context
      text = content.text;
    } catch {
      continue; // a single unreadable context file never fails the run
    }
    if (!text.trim()) continue;

    const section = `### ${f.name || f.id}\n${text.trim()}`;
    fingerprint[f.id] = f.version ?? "";
    if (total + section.length > MAX_CONTEXT_CHARS) {
      const room = MAX_CONTEXT_CHARS - total;
      if (room > 0) sections.push(section.slice(0, room));
      break;
    }
    sections.push(section);
    total += section.length;
  }

  return sections.length > 0 ? { text: sections.join("\n\n"), fingerprint } : null;
}

// Backwards-compatible raw reader (also used as the distillation fallback).
export async function getProjectContext(sourceFolderId: string): Promise<string | null> {
  const ctx = await gatherContext(sourceFolderId);
  return ctx ? ctx.text : null;
}

function sameFingerprint(
  a: Record<string, string> | null | undefined,
  b: Record<string, string>,
): boolean {
  if (!a) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

type BriefCache = { fingerprint: Record<string, string>; brief: string };

// Read the cached brief from the output folder, or null if absent/unreadable.
async function readBriefCache(
  outputFolderId: string,
): Promise<{ fileId: string; cache: BriefCache } | null> {
  try {
    const file = (await listFolder(outputFolderId)).find((f) => f.name === BRIEF_CACHE_NAME);
    if (!file) return null;
    const { data } = await getFileBytes(file.id);
    const cache = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as BriefCache;
    if (!cache || typeof cache.brief !== "string" || typeof cache.fingerprint !== "object") {
      return null;
    }
    return { fileId: file.id, cache };
  } catch {
    return null;
  }
}

// Overwrite the cached brief in the output folder (best-effort).
async function writeBriefCache(
  outputFolderId: string,
  oldFileId: string | null,
  cache: BriefCache,
): Promise<void> {
  try {
    await uploadFile({
      name: BRIEF_CACHE_NAME,
      parentId: outputFolderId,
      mimeType: "application/json",
      body: JSON.stringify(cache),
    });
    if (oldFileId) await trashFile(oldFileId).catch(() => {});
  } catch {
    // a cache write failure is non-fatal — the brief is still returned this run
  }
}

const BRIEF_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { brief: { type: Type.STRING } },
  required: ["brief"],
};

const BRIEF_SYSTEM =
  "You are a project-management analyst. Distill the supplied project context into " +
  "a tight, factual brief that another analyst can use as background when writing a " +
  "progress report. Cover, only where present: the project's objectives, key terms " +
  "and acronyms, stakeholders and partners, scope, and constraints. Be terse; keep " +
  "only what helps interpret progress. Do not invent anything not in the source. " +
  "Respond only as JSON matching the provided schema.";

// Distilled, cached project brief for the synthesis prompt. Reuses the cached
// brief when the Context fingerprint is unchanged; otherwise distills via Flash
// and refreshes the cache. Falls back to the raw text on any distill failure, and
// returns null when there is no Context.
export async function getProjectBrief(input: {
  sourceFolderId: string;
  outputFolderId: string;
}): Promise<string | null> {
  const ctx = await gatherContext(input.sourceFolderId);
  if (!ctx) return null;

  const existing = await readBriefCache(input.outputFolderId);
  if (existing && sameFingerprint(existing.cache.fingerprint, ctx.fingerprint)) {
    return existing.cache.brief; // cache hit — no distill, no write
  }

  // Cache miss → distill. On failure, fall back to the raw text (still grounds the
  // report, just without the cost saving this run).
  let brief: string;
  try {
    const out = await generateStructured<{ brief: string }>({
      model: "gemini-3.5-flash",
      systemInstruction: BRIEF_SYSTEM,
      prompt: `--- PROJECT CONTEXT ---\n${ctx.text}\n--- END ---`,
      responseSchema: BRIEF_SCHEMA,
      temperature: 0,
    });
    brief = out.brief?.trim() || ctx.text;
  } catch {
    return ctx.text;
  }

  await writeBriefCache(input.outputFolderId, existing?.fileId ?? null, {
    fingerprint: ctx.fingerprint,
    brief,
  });
  return brief;
}
