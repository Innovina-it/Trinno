import "server-only";

import {
  getStartPageToken,
  listChanges,
  listFolderTree,
  listRevisions,
} from "./clients/drive";
import { isAnalyzable } from "./content";
import type { DriveFile, DriveRevision } from "./clients/drive";

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
  // The version-gate key (Drive `version`, monotonic, populated for Google docs
  // where headRevisionId is null). null only for removed files.
  version: string | null;
  // U12.4 — displayName of the file's last modifier (null when unknown/removed).
  lastModifiedBy: string | null;
  // U12.9 — display names of users who made a revision WITHIN the run's window
  // (window mode only; undefined otherwise). Drives per-period attribution.
  windowAuthors?: string[];
  // Set true when listing this file's revisions FAILED (Drive error: rate limit,
  // permission denied, network) — as opposed to the file genuinely having no
  // revisions. Lets downstream tell "history unavailable" apart from "no history"
  // so a transient Google error is never silently reported as "nothing changed".
  revisionsUnavailable?: boolean;
  // null only for removed files (no mimeType to classify).
  kind: FileKind | null;
  isDeliverable: boolean;
  cardLinkId: string | null;
  changeType: "added_or_edited" | "removed";
};

export type DeliverableLink = { id: string; url: string };

// U12.2 — an explicit [start,end] reporting window (ISO timestamps, inclusive).
export type DetectWindow = { start: string; end: string };

export type DetectInput = {
  sourceFolderId: string;
  // null → first run (bootstrap with getStartPageToken + full folder listing).
  // Ignored entirely in WINDOW mode.
  pageToken: string | null;
  // Workspace card-scope links, cross-referenced read-only to tag deliverables.
  deliverableLinks: DeliverableLink[];
  // U12.2 — when present, run in WINDOW mode: list the Source folder and keep
  // files whose modifiedTime falls in [start,end]. The Changes-API page-token
  // path is bypassed (the window is the scope, not "since the last run"). No
  // removed-file detection in this mode — there is no change feed to read it
  // from; and a file edited in the window but last-modified later is missed here
  // (U12.4 refines window membership via the revisions API).
  window?: DetectWindow;
  // U12.10 — when true (and no window), ALL-FILES mode: every current Source file
  // is included, no date filter. Used for the "whole document" report when the
  // user picks no date.
  allFiles?: boolean;
};

export type DetectResult = {
  files: DetectedFile[];
  // The checkpoint to persist for the next incremental run. null in WINDOW mode
  // (no page token is produced or advanced there).
  newPageToken: string | null;
  bootstrapped: boolean;
  // U12.10 — the documents' available date range (oldest createdTime → newest
  // modifiedTime across the Source folder), computed in WINDOW mode so the caller
  // can tell the user where to look when a chosen window matched nothing.
  corpusRange?: { first: string | null; last: string | null };
  // Count of files whose revision history could not be loaded due to a Drive
  // error (NOT genuine emptiness). Absent/0 = every history read succeeded; > 0
  // means attribution/membership for that many files is best-effort and the
  // report may be incomplete — surface it rather than treating it as "no history".
  revisionErrorCount?: number;
};

// Runtime categorization (DESIGN §3 B). "editable" = a type the analyzer can read
// (Google-native, PDF/images, or Office — see lib/pma/content.ts). Everything
// else (folders, archives, unknown binaries) is `non_mod` and is skipped.
export function categorize(mimeType: string): FileKind {
  return isAnalyzable(mimeType) ? "editable" : "non_mod";
}

// U12.11 — label for a revision whose author Drive does not expose (an
// "anonymous" edit, shown as "Tutti gli utenti anonimi" in Drive's history). We
// surface it explicitly instead of dropping it, so the report says an anonymous
// person made the change rather than silently omitting it.
const ANON_AUTHOR = "anonymous user";

// Distinct attribution labels for a set of revisions: each named author once,
// plus "anonymous user" if any revision had no exposed author.
function authorsFromRevisions(revs: DriveRevision[]): string[] {
  return Array.from(new Set(revs.map((r) => r.authorName ?? ANON_AUTHOR)));
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

// U12.10 — the documents' activity envelope: oldest createdTime → newest
// modifiedTime across the Source listing. Surfaced when a chosen window matched
// no file, so the user knows the valid range.
function corpusRangeOf(files: DriveFile[]): { first: string | null; last: string | null } {
  let firstMs = Infinity;
  let lastMs = -Infinity;
  let first: string | null = null;
  let last: string | null = null;
  for (const f of files) {
    const c = f.createdTime ? Date.parse(f.createdTime) : NaN;
    const m = f.modifiedTime ? Date.parse(f.modifiedTime) : NaN;
    if (!Number.isNaN(c) && c < firstMs) {
      firstMs = c;
      first = f.createdTime;
    }
    if (!Number.isNaN(m) && m > lastMs) {
      lastMs = m;
      last = f.modifiedTime;
    }
  }
  return { first, last };
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
  // Recursive: plan-import nests deliverable Docs under Documents/<WP>/Deliverables/.
  // Skip the Reports output folder so analysis never re-reads its own reports, and
  // skip the Context folder so project-background docs are never tracked/analyzed
  // (they are read separately by lib/pma/context.ts and fed to the synthesis).
  const currentList = await listFolderTree(sourceFolderId, {
    skipNames: ["Reports", "Context"],
  });
  const currentById = new Map<string, DriveFile>();
  for (const f of currentList) currentById.set(f.id, f);

  const tag = (file: DriveFile): DetectedFile => ({
    fileId: file.id,
    name: file.name || null,
    mimeType: file.mimeType || null,
    modifiedTime: file.modifiedTime || null,
    headRevisionId: file.headRevisionId,
    version: file.version,
    lastModifiedBy: file.lastModifiedBy,
    kind: categorize(file.mimeType),
    isDeliverable: deliverableByFileId.has(file.id),
    cardLinkId: deliverableByFileId.get(file.id) ?? null,
    changeType: "added_or_edited",
  });

  // ── Window mode (U12.2, revisions as of U12.9): scope BY REVISION within
  //    [start,end]; no change feed, no page token. A file is in-window if it has
  //    ≥1 revision in the window (so a file last edited AFTER the window but
  //    revised inside it is still caught). windowAuthors = who revised in the
  //    window → per-period attribution. Removed files aren't detectable here.
  if (input.window) {
    const startMs = Date.parse(input.window.start);
    const endMs = Date.parse(input.window.end);
    const inWin = (iso: string | null): boolean => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    };
    const files: DetectedFile[] = [];
    let revisionErrorCount = 0;
    for (const f of currentList) {
      // Prune: a file last modified before the window can't have a revision in
      // it (modifiedTime is the LAST edit). Skips the revisions call for most.
      if (f.modifiedTime) {
        const mt = Date.parse(f.modifiedTime);
        if (!Number.isNaN(mt) && mt < startMs) continue;
      }
      let revs: DriveRevision[] = [];
      let revisionsUnavailable = false;
      try {
        revs = await listRevisions(f.id);
      } catch (err) {
        // Drive error (rate limit / permission / network) — NOT proof the file
        // has no history. Flag + count it instead of silently treating it as
        // empty, and include the file below rather than risk dropping one that
        // was revised in-window.
        revisionsUnavailable = true;
        revisionErrorCount += 1;
        console.warn(
          `[pma/detect] revisions unavailable for file ${f.id}; including it as flagged rather than treating as no-history`,
          err,
        );
      }
      const windowRevs = revs.filter((r) => inWin(r.modifiedTime));
      // Membership: a revision in the window. If the revisions call FAILED we can
      // neither confirm nor deny window membership → INCLUDE the file (flagged)
      // so a possibly-in-window revision is never silently lost. If Drive returned
      // a genuinely empty list, fall back to the file's modifiedTime as before.
      const member = revisionsUnavailable
        ? true
        : revs.length > 0
          ? windowRevs.length > 0
          : inWin(f.modifiedTime);
      if (!member) continue;
      files.push({
        ...tag(f),
        windowAuthors: authorsFromRevisions(windowRevs),
        ...(revisionsUnavailable ? { revisionsUnavailable: true } : {}),
      });
    }
    return {
      files,
      newPageToken: null,
      bootstrapped: false,
      corpusRange: corpusRangeOf(currentList),
      ...(revisionErrorCount > 0 ? { revisionErrorCount } : {}),
    };
  }

  // ── All-files mode (U12.10/U12.11): the whole document — every current Source
  //    file, no date filter. Attribution = ALL named revision authors (so every
  //    contributor is credited, not just the last modifier). Anonymous edits
  //    (Drive exposes no displayName) are dropped → "non noto" only if NONE named.
  if (input.allFiles) {
    const files: DetectedFile[] = [];
    let revisionErrorCount = 0;
    for (const f of currentList) {
      let revs: DriveRevision[] = [];
      let revisionsUnavailable = false;
      try {
        revs = await listRevisions(f.id);
      } catch (err) {
        // Drive error — NOT an authorless file. Flag + count it so attribution
        // degrades to the last modifier honestly instead of falsely reading as
        // "non noto" (no known author).
        revisionsUnavailable = true;
        revisionErrorCount += 1;
        console.warn(
          `[pma/detect] revisions unavailable for file ${f.id}; attribution may be incomplete`,
          err,
        );
      }
      files.push({
        ...tag(f),
        windowAuthors: authorsFromRevisions(revs),
        ...(revisionsUnavailable ? { revisionsUnavailable: true } : {}),
      });
    }
    return {
      files,
      newPageToken: null,
      bootstrapped: false,
      corpusRange: corpusRangeOf(currentList),
      ...(revisionErrorCount > 0 ? { revisionErrorCount } : {}),
    };
  }

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
      version: null,
      lastModifiedBy: null,
      kind: null,
      isDeliverable: deliverableByFileId.has(id),
      cardLinkId: deliverableByFileId.get(id) ?? null,
      changeType: "removed",
    });
  }

  return { files, newPageToken, bootstrapped: false };
}
