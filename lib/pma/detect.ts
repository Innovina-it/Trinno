import "server-only";

import {
  getStartPageToken,
  listChanges,
  listFolder,
} from "./clients/drive";
import type { DriveFile } from "./clients/drive";

// PMA U5 — DETECT (DESIGN §3 steps A + B).
//
// Step A (detect): the Drive Changes API tells us WHAT changed since the last
// run; a persisted page token makes it incremental. Step B (categorize):
// classify each changed file by mimeType (editable vs non_mod) and cross-ref it
// against the workspace's deliverable card-links (read-only).
//
// STATELESS BY DESIGN. detect() never persists the page token — it returns
// `newPageToken` and the orchestrator (U9) checkpoints it. This unit owns no
// migration and reads/writes no registry; it only READS Drive.
//
// SCOPING NOTE. The Changes API is drive-wide — it reports changes across the
// whole service-account corpus, including trinno's own Output-folder recap
// writes, and the change feed carries no `parents`. So we cannot scope to the
// source folder from the feed alone. Instead `listFolder(sourceFolderId)` is
// the authoritative scope oracle: a changed fileId is in-scope only if it is
// currently a child of the source folder. Output-folder churn is dropped
// because those ids are not in the source listing. Removed-file scoping is
// best-effort here (a removed id is no longer listable) and is finalized by U8
// reconcile, which intersects against the registry (source files only).

export type FileKind = "editable" | "non_mod";

export type DetectedFile = {
  fileId: string;
  name: string | null;
  mimeType: string | null;
  modifiedTime: string | null;
  headRevisionId: string | null;
  // null only for removed files (no mimeType to classify).
  kind: FileKind | null;
  isDeliverable: boolean;
  cardLinkId: string | null;
  changeType: "added_or_edited" | "removed";
};

export type DeliverableLink = { id: string; url: string };

export type DetectInput = {
  sourceFolderId: string;
  // null → first run (bootstrap with getStartPageToken + full folder listing).
  pageToken: string | null;
  // Workspace card-scope links, cross-referenced read-only to tag deliverables.
  deliverableLinks: DeliverableLink[];
};

export type DetectResult = {
  files: DetectedFile[];
  // The checkpoint to persist for the next incremental run.
  newPageToken: string;
  bootstrapped: boolean;
};

// Google-native editable document types — the only files step D deep-analyses.
const EDITABLE_MIME_TYPES = new Set<string>([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);

// Runtime categorization (DESIGN §3 B). Everything that is not a Google-native
// editable type is `non_mod` (pdf, images, Office files, folders, …).
export function categorize(mimeType: string): FileKind {
  return EDITABLE_MIME_TYPES.has(mimeType) ? "editable" : "non_mod";
}

// Pull the Drive fileId out of a Drive/Docs URL. Handles the shapes deliverable
// links take: /folders/{id}, /file/d/{id}, /document|spreadsheets|presentation/
// d/{id}, and ?id={id}. Returns null for any non-Drive or unparseable URL.
export function extractDriveFileId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(parsed.hostname)) return null;
  const dMatch = parsed.pathname.match(/\/d\/([^/]+)/);
  if (dMatch) return dMatch[1];
  const folderMatch = parsed.pathname.match(/\/folders\/([^/]+)/);
  if (folderMatch) return folderMatch[1];
  const idParam = parsed.searchParams.get("id");
  if (idParam) return idParam;
  return null;
}

export async function detect(input: DetectInput): Promise<DetectResult> {
  const { sourceFolderId, pageToken, deliverableLinks } = input;

  // Deliverable cross-ref: drive fileId → the card-link id it maps to. First
  // match wins (a fileId linked from multiple cards is rare; keep it stable).
  const deliverableByFileId = new Map<string, string>();
  for (const link of deliverableLinks) {
    const fid = extractDriveFileId(link.url);
    if (fid && !deliverableByFileId.has(fid)) deliverableByFileId.set(fid, link.id);
  }

  // Scope oracle — the authoritative current contents of the SOURCE folder.
  const currentList = await listFolder(sourceFolderId);
  const currentById = new Map<string, DriveFile>();
  for (const f of currentList) currentById.set(f.id, f);

  const tag = (file: DriveFile): DetectedFile => ({
    fileId: file.id,
    name: file.name || null,
    mimeType: file.mimeType || null,
    modifiedTime: file.modifiedTime || null,
    headRevisionId: file.headRevisionId,
    kind: categorize(file.mimeType),
    isDeliverable: deliverableByFileId.has(file.id),
    cardLinkId: deliverableByFileId.get(file.id) ?? null,
    changeType: "added_or_edited",
  });

  // ── Bootstrap (first run): seed every current source file; the start token
  //    becomes the "since previous analysis" checkpoint for the next run.
  if (pageToken === null) {
    const newPageToken = await getStartPageToken();
    return {
      files: currentList.map(tag),
      newPageToken,
      bootstrapped: true,
    };
  }

  // ── Incremental: walk the change feed to its terminal newStartPageToken.
  const changedIds = new Set<string>();
  const removedIds = new Set<string>();
  let token = pageToken;
  let newPageToken: string | null = null;
  for (;;) {
    const page = await listChanges(token);
    for (const c of page.changes) {
      if (!c.fileId) continue;
      if (c.removed || !c.file) {
        if (!changedIds.has(c.fileId)) removedIds.add(c.fileId);
      } else {
        changedIds.add(c.fileId);
        // A later edit supersedes an earlier removal of the same file.
        removedIds.delete(c.fileId);
      }
    }
    if (page.newStartPageToken) {
      newPageToken = page.newStartPageToken;
      break;
    }
    if (!page.nextPageToken) break;
    token = page.nextPageToken;
  }
  if (newPageToken === null) {
    throw new Error("detect: change feed ended without a newStartPageToken.");
  }

  const files: DetectedFile[] = [];
  // Adds/edits — in scope only if the id is currently a child of the source
  // folder (drops Output-folder and other out-of-scope corpus churn).
  for (const id of changedIds) {
    const file = currentById.get(id);
    if (file) files.push(tag(file));
  }
  // Removals — reported in the feed AND no longer present in the source folder.
  for (const id of removedIds) {
    if (currentById.has(id)) continue;
    files.push({
      fileId: id,
      name: null,
      mimeType: null,
      modifiedTime: null,
      headRevisionId: null,
      kind: null,
      isDeliverable: deliverableByFileId.has(id),
      cardLinkId: deliverableByFileId.get(id) ?? null,
      changeType: "removed",
    });
  }

  return { files, newPageToken, bootstrapped: false };
}
