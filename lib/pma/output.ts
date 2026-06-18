import "server-only";

import {
  createDoc,
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
// Output-folder layout this module materializes:
//   [Reports Drive folder]/{name}             the run report (Google Doc)
// The Reports folder is a SIBLING of the Documents folder (see the connected
// analysis loop design), so reports are written directly into it — no subfolder.

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

// Create a run report as a native Google Doc directly in the workspace's Reports
// (output) folder. Returns the new Doc id + webViewLink (the link the Analysis
// tab surfaces). The Reports folder is a SIBLING of Documents and is never
// scanned, so writing into it does not feed the analysis back its own output.
export async function createReport(
  outputFolderId: string,
  input: { name: string; content: string },
): Promise<{ id: string; webViewLink: string }> {
  return createDoc({ name: input.name, parentId: outputFolderId, content: input.content });
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
