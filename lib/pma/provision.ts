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
//   <root>/<projectName>/Documents   (analysis reads this, recursively)
//   <root>/<projectName>/Reports     (analysis writes reports here; never scanned)
// Idempotent: re-running resolves the same ids.
export async function provisionProjectFolders(
  rootFolderId: string,
  projectName: string,
): Promise<{ projectFolderId: string; documentsFolderId: string; reportsFolderId: string }> {
  const projectFolderId = await ensureChildFolder(rootFolderId, projectName);
  const documentsFolderId = await ensureChildFolder(projectFolderId, "Documents");
  const reportsFolderId = await ensureChildFolder(projectFolderId, "Reports");
  return { projectFolderId, documentsFolderId, reportsFolderId };
}
