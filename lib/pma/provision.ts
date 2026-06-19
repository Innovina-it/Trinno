import "server-only";

import { listFolder, createFolder } from "@/lib/pma/clients/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

// find-or-create a child folder by exact name under parentId.
async function ensureChildFolder(parentId: string, name: string): Promise<string> {
  const existing = (await listFolder(parentId)).find(
    (f) => f.mimeType === FOLDER_MIME && f.name === name,
  );
  return existing ? existing.id : (await createFolder(name, parentId)).id;
}

// Provision the per-project folder structure under the shared Trinno root:
//   <root>/<projectName>/Documents          (analysis reads this, recursively)
//   <root>/<projectName>/Documents/Context  (project background; read, never scanned)
//   <root>/<projectName>/Reports            (analysis writes reports here; never scanned)
// Context lives INSIDE Documents (not beside it) so the run can find it by listing
// the source folder without storing its id; the recursive scan skips "Context".
// Idempotent: re-running resolves the same ids.
export async function provisionProjectFolders(
  rootFolderId: string,
  projectName: string,
): Promise<{
  projectFolderId: string;
  documentsFolderId: string;
  reportsFolderId: string;
  contextFolderId: string;
}> {
  const projectFolderId = await ensureChildFolder(rootFolderId, projectName);
  const documentsFolderId = await ensureChildFolder(projectFolderId, "Documents");
  const reportsFolderId = await ensureChildFolder(projectFolderId, "Reports");
  const contextFolderId = await ensureChildFolder(documentsFolderId, "Context");
  return { projectFolderId, documentsFolderId, reportsFolderId, contextFolderId };
}

// find-or-create a "Reports" child inside an existing documents folder (Manual
// mode, where the user's pasted folder IS the documents folder). The recursive
// analysis scan skips any folder named "Reports".
export async function ensureReportsChild(documentsFolderId: string): Promise<string> {
  return ensureChildFolder(documentsFolderId, "Reports");
}

// find-or-create a "Context" child inside an existing documents folder (Manual
// mode). Holds project-background docs the analysis reads but never tracks; the
// recursive scan skips any folder named "Context".
export async function ensureContextChild(documentsFolderId: string): Promise<string> {
  return ensureChildFolder(documentsFolderId, "Context");
}
