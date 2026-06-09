import "server-only";

import {
  createDoc,
  createFolder,
  listFolder,
  trashFile,
  type DriveFile,
} from "@/lib/pma/clients/drive";

// Server-only helpers that write trinno-managed documents into the workspace
// OUTPUT folder. Layered ON TOP of the existing U1a Drive client
// (`lib/pma/clients/drive.ts`) — this module adds no auth and creates no new
// googleapis client; it composes the client's primitives.
//
// SECRETS ARE SERVER-ONLY. The `import "server-only"` guard mirrors the client
// and makes this module throw if it is ever pulled into a client bundle.
//
// INVARIANT (DESIGN §1, §4): trinno only WRITES to the OUTPUT folder tree,
// never the Source folder. Every helper here takes an explicit OUTPUT folder id
// and writes only under it (or under a sub-folder of it). There is NO database
// access of any kind — the Postgres registry (DESIGN §4.3) is a different unit
// (U4a). The output folder is the system of record; these helpers are what make
// it rebuildable.
//
// Output-folder layout this module materializes (DESIGN §4.2, as amended by
// U12.1 — recaps/ removed; recap bodies now live in Postgres):
//   [Output Drive folder]/
//     analyses/{name}                         the run report (Google Doc)
// The analyses/ sub-folder is created idempotently via ensureSubfolder.

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Sub-folder name under the output folder (DESIGN §4.2). recaps/ is gone as of
// U12.1 — recap bodies now live in Postgres (pma_file_registry.recap_json).
const ANALYSES_FOLDER = "analyses";

// A minimal child-entry shape for rebuild/inspection (DESIGN §4.2 — "the
// registry [is] reconstructable by listing this folder").
export type OutputEntry = {
  id: string;
  name: string;
  mimeType: string;
};

function toEntry(f: DriveFile): OutputEntry {
  return { id: f.id, name: f.name, mimeType: f.mimeType };
}

// Find an existing immediate child folder of `parentFolderId` by exact name, or
// `null` if none exists. Used to keep ensureSubfolder idempotent.
async function findChildFolder(
  parentFolderId: string,
  name: string,
): Promise<DriveFile | null> {
  const children = await listFolder(parentFolderId);
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME && child.name === name) return child;
  }
  return null;
}

// Idempotently ensure a sub-folder named `name` exists directly under
// `parentFolderId`, returning its folder id. Finds an existing child folder by
// name first and only creates one if it is missing — so calling this twice
// never produces a duplicate folder.
export async function ensureSubfolder(
  parentFolderId: string,
  name: string,
): Promise<string> {
  const existing = await findChildFolder(parentFolderId, name);
  if (existing) return existing.id;
  const created = await createFolder(name, parentFolderId);
  return created.id;
}

// Create a run report as a native Google Doc under the output folder's
// analyses/ sub-folder (DESIGN §4.2, §5.2). The analyses/ sub-folder is ensured
// idempotently. Returns the new Doc id and its webViewLink (the link the
// Analysis tab surfaces).
export async function createReport(
  outputFolderId: string,
  input: { name: string; content: string },
): Promise<{ id: string; webViewLink: string }> {
  const analysesFolderId = await ensureSubfolder(outputFolderId, ANALYSES_FOLDER);
  return createDoc({
    name: input.name,
    parentId: analysesFolderId,
    content: input.content,
  });
}

// List the immediate children of an output-tree folder (the output folder
// itself, or its analyses/ sub-folder) for rebuild/inspection.
// Returns id/name/mimeType per child.
export async function listOutput(folderId: string): Promise<OutputEntry[]> {
  const files = await listFolder(folderId);
  return files.map(toEntry);
}

// Re-export trashFile so cleanup of output artifacts goes through this module
// without callers reaching back into the client directly. (Only ever call this
// against artifacts in the OUTPUT tree.)
export { trashFile };
