import "server-only";

import { listFolder, listFolderTree } from "@/lib/pma/clients/drive";
import { getAnalyzableContent, isAnalyzable } from "./content";

// PMA — PROJECT CONTEXT (background docs the analysis is grounded in).
//
// A "Context" folder lives INSIDE the Source/Documents folder (created at setup by
// provision / pma-folders). The analysis SCAN skips it (detect's skipNames), so its
// files are never detected, recapped, version-tracked, or counted — they are read
// ONLY here and injected into the synthesis prompt as project background.
//
// v1 is TEXT-ONLY: Google-native + Office docs are exported to text and concatenated
// (with a per-run size cap); PDFs/images and anything non-analyzable are skipped.
// A single unreadable file is skipped, never fatal. Returns null when there is no
// Context folder or it yields no text — the run is then byte-identical to before.

const CONTEXT_FOLDER_NAME = "Context";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Cap the concatenated context so a large folder can't blow up the synthesis
// prompt. Generous but bounded.
export const MAX_CONTEXT_CHARS = 100_000;

export async function getProjectContext(
  sourceFolderId: string,
): Promise<string | null> {
  // Find the Context folder as a direct child of the Source folder.
  const children = await listFolder(sourceFolderId);
  const contextFolder = children.find(
    (f) => f.mimeType === FOLDER_MIME && f.name === CONTEXT_FOLDER_NAME,
  );
  if (!contextFolder) return null;

  // Every file under Context, at any depth (listFolderTree returns files only).
  const files = await listFolderTree(contextFolder.id);

  const sections: string[] = [];
  let total = 0;
  for (const f of files) {
    if (!f.mimeType || !isAnalyzable(f.mimeType)) continue;
    let text: string;
    try {
      const content = await getAnalyzableContent(f.id, f.mimeType);
      if (!("text" in content)) continue; // v1: skip binary (PDF/image) context
      text = content.text;
    } catch {
      continue; // a single unreadable context file never fails the run
    }
    if (!text.trim()) continue;

    const section = `### ${f.name || f.id}\n${text.trim()}`;
    if (total + section.length > MAX_CONTEXT_CHARS) {
      const room = MAX_CONTEXT_CHARS - total;
      if (room > 0) sections.push(section.slice(0, room));
      break;
    }
    sections.push(section);
    total += section.length;
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}
