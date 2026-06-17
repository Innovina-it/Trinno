import "server-only";

import { listFolder, createFolder, createDoc } from "@/lib/pma/clients/drive";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML body uploaded as a native Google Doc (Drive converts text/html). Replaces
// the CLI's .docx template + zipfile placeholder-patch entirely.
export function deliverableDocHtml(input: { title: string; subtitle: string }): string {
  const t = esc(input.title);
  const s = esc(input.subtitle);
  return [
    `<h1>${t}</h1>`,
    `<p><i>${s}</i></p>`,
    `<h2>Executive summary</h2><p></p>`,
    `<h2>Scope</h2><p></p>`,
    `<h2>Content</h2><p></p>`,
    `<h2>References</h2><p></p>`,
  ].join("\n");
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// find-or-create a child folder by name under parentId (cached per build).
async function ensureFolder(
  cache: Map<string, string>,
  parentId: string,
  name: string,
): Promise<string> {
  const key = `${parentId}/${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = (await listFolder(parentId)).find(
    (f) => f.name === name && f.mimeType === FOLDER_MIME,
  );
  const id = existing ? existing.id : (await createFolder(name, parentId)).id;
  cache.set(key, id);
  return id;
}

export type DriveDocsClient = {
  createDeliverableDoc(input: {
    wpTitle: string;
    deliverableTitle: string;
    subtitle: string;
  }): Promise<{ webViewLink: string }>;
};

// Build a per-import Drive client rooted at folderId. Layout:
//   <folderId>/<WP title>/Deliverables/<deliverable doc>
export function makeDriveDocsClient(folderId: string): DriveDocsClient {
  const folderCache = new Map<string, string>();
  return {
    async createDeliverableDoc({ wpTitle, deliverableTitle, subtitle }) {
      const wpFolder = await ensureFolder(folderCache, folderId, wpTitle);
      const delFolder = await ensureFolder(folderCache, wpFolder, "Deliverables");
      const { webViewLink } = await createDoc({
        name: deliverableTitle,
        parentId: delFolder,
        content: deliverableDocHtml({ title: deliverableTitle, subtitle }),
      });
      return { webViewLink };
    },
  };
}

// Fail-fast probe: confirm the SA can read the folder before any build write.
// Throws if the folder is missing / not shared with the service account.
export async function probeFolder(folderId: string): Promise<void> {
  await listFolder(folderId);
}

// Auto mode: find-or-create a folder named after the project under the shared
// root (the "Trinno" drive). Returns the project folder id, which then roots the
// per-import doc client. Idempotent: re-importing the same project reuses it.
export async function resolveProjectFolder(
  rootFolderId: string,
  projectName: string,
): Promise<string> {
  const existing = (await listFolder(rootFolderId)).find(
    (f) => f.name === projectName && f.mimeType === FOLDER_MIME,
  );
  return existing ? existing.id : (await createFolder(projectName, rootFolderId)).id;
}
