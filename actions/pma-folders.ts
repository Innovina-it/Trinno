"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, getWorkspaceRole } from "@/lib/queries/workspaces";
import { upsertWorkspaceLinkImpl } from "@/actions/links";
import { provisionProjectFolders } from "@/lib/pma/provision";
import { extractDriveFileId } from "@/lib/pma/detect";
import { createFolder, listFolder } from "@/lib/pma/clients/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

// Configure a workspace's analysis folders in one owner/admin action. Sets the
// existing `source` (Documents) and `reports` (Reports) workspace links.
//  - auto:   provision <root>/<project>/{Documents, Reports} under the Trinno root,
//            plus a Documents/Context child for project-background docs.
//  - manual: the pasted folder IS the Documents folder; create Reports + Context
//            children inside it (the recursive scan skips folders named "Reports"
//            and "Context"). Context is read by the analysis but never tracked.
export async function setWorkspaceDriveFolderAction(input: {
  workspaceId: string;
  mode: "auto" | "manual";
  folderLink?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const role = await getWorkspaceRole(token, input.workspaceId, user.id);
  if (role !== "owner" && role !== "admin") {
    return { ok: false, error: "Only an owner or admin can configure the analysis folder." };
  }

  let documentsId: string;
  let reportsId: string;

  if (input.mode === "auto") {
    const root = process.env.PLAN_IMPORT_DRIVE_ROOT?.trim();
    if (!root) return { ok: false, error: "Auto folder not configured (set PLAN_IMPORT_DRIVE_ROOT)." };
    const ws = await getWorkspace(token, input.workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found." };
    const folders = await provisionProjectFolders(root, ws.name);
    documentsId = folders.documentsFolderId;
    reportsId = folders.reportsFolderId;
  } else {
    const pasted = extractDriveFileId(input.folderLink ?? "");
    if (!pasted) return { ok: false, error: "Paste a Google Drive folder link." };
    documentsId = pasted;
    const children = await listFolder(pasted);
    const findChild = (name: string) =>
      children.find((f) => f.mimeType === FOLDER_MIME && f.name === name);
    const existingReports = findChild("Reports");
    reportsId = existingReports ? existingReports.id : (await createFolder("Reports", pasted)).id;
    // Project-background folder: the analysis reads it but never tracks it (the
    // recursive scan skips "Context"). Create it once if absent.
    if (!findChild("Context")) await createFolder("Context", pasted);
  }

  await upsertWorkspaceLinkImpl(token, {
    workspaceId: input.workspaceId,
    url: folderUrl(documentsId),
    purpose: "source",
  });
  await upsertWorkspaceLinkImpl(token, {
    workspaceId: input.workspaceId,
    url: folderUrl(reportsId),
    purpose: "reports",
  });
  revalidatePath(`/w/${input.workspaceId}/analysis`);
  return { ok: true };
}
