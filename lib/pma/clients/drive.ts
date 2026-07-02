import "server-only";

import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

// Server-only Google Drive API client for the PM Assistant (PMA).
//
// Scope (this unit — U1a): a typed service-account client that can READ a
// Source folder and WRITE to an Output folder. No detection, no registry, no
// Gemini, no orchestration — those are later units.
//
// SECRETS ARE SERVER-ONLY. The `import "server-only"` guard above makes this
// module throw if it is ever pulled into a client bundle. The service-account
// JSON is loaded LAZILY the first time a client is built — importing this module
// never touches the filesystem or env, so type-check/build/tests pass with no
// credentials configured. Two sources, inline-wins: GOOGLE_SERVICE_ACCOUNT_JSON
// (the raw JSON, for prod/Vercel where there is no secret file on disk) or
// GOOGLE_APPLICATION_CREDENTIALS (a path to the JSON file, for local dev, e.g.
// .secrets/pma-sa.json).
//
// INVARIANT: trinno only WRITES to the Output folder, never the Source folder.
// Read methods (listFolder/getFile/getStartPageToken/listChanges) are safe
// against any folder; write methods (createFolder/uploadFile/createDoc/
// trashFile) take an explicit target and callers must only ever point them at
// the Output folder. This module does not itself know which folder is which.

// Full read+write Drive scope — limited in practice to folders shared with the
// service account (Source = Viewer/Commenter, Output = Editor).
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

// Shared-drive support flags applied to every call so the client works whether
// the test folders live in My Drive or a Shared Drive.
const SHARED_DRIVE_READ = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
} as const;
const SHARED_DRIVE_WRITE = { supportsAllDrives: true } as const;

// The minimal file metadata shape the PMA pipeline relies on. `headRevisionId`
// is the version-gate checkpoint (survives metadata-only edits); `modifiedTime`
// is display-only.
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  // headRevisionId is populated only for BINARY files — it is null for
  // Google-native editable docs. `version` (monotonic, all files incl. Google
  // docs) is the actual change-gate key the PMA pipeline uses.
  headRevisionId: string | null;
  version: string | null;
  // U12.4 — displayName of the file's last modifier (Drive lastModifyingUser),
  // or null when Drive does not expose it. Surfaced in the report as attribution.
  lastModifiedBy: string | null;
  // emailAddress of the file's last modifier (Drive often exposes it within the
  // same workspace/domain), or null. The stable identity key the org map matches
  // on first, falling back to the displayName.
  lastModifiedByEmail: string | null;
  // U12.10 — when the file was created / last modified (ISO). Used to report the
  // documents' available date range when a chosen window matches nothing.
  createdTime: string | null;
  // #4 — the names of the source-relative ancestor folders, root → file's parent
  // (e.g. ["First Output (old)", "Presentazioni"]); [] for a direct child of the
  // source root. Populated only by listFolderTree (which walks the tree); a bare
  // listFolder leaves it undefined. Lets the report flag superseded-folder files.
  folderPath?: string[];
};

// Result of listChanges: the changed/removed files since a page token plus the
// token to persist for the next incremental run. `newStartPageToken` is present
// only on the final page (no more changes) and is the value to checkpoint.
export type DriveChange = {
  fileId: string | null;
  removed: boolean;
  file: DriveFile | null;
};
export type DriveChanges = {
  changes: DriveChange[];
  nextPageToken: string | null;
  newStartPageToken: string | null;
};

export type UploadFileInput = {
  name: string;
  parentId: string;
  mimeType: string;
  body: Buffer | Uint8Array | string | Readable;
};

export type CreateDocInput = {
  name: string;
  parentId: string;
  content: string;
};

// Fields requested for every file lookup so DriveFile is always fully hydrated.
const FILE_FIELDS =
  "id, name, mimeType, modifiedTime, createdTime, headRevisionId, version, lastModifyingUser(displayName, emailAddress)";

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
    headRevisionId: f.headRevisionId ?? null,
    version: f.version ?? null,
    // `|| null` (not `?? null`) so an empty/blank displayName — Drive's shape for
    // an anonymous editor — collapses to null, not "".
    lastModifiedBy: f.lastModifyingUser?.displayName?.trim() || null,
    lastModifiedByEmail: f.lastModifyingUser?.emailAddress?.trim().toLowerCase() || null,
    createdTime: f.createdTime ?? null,
  };
}

// Cached authenticated client. Built lazily on first use so importing this
// module is side-effect-free (no env read, no file read).
let cachedDrive: drive_v3.Drive | null = null;

export type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

// Where the service-account JSON comes from. Inline JSON (prod / Vercel, where
// there is no secret file on disk) takes precedence over a file path (local
// dev). Pure + env-injected so it is unit-testable.
export function pickCredentialSource(env: {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
}): { kind: "inline"; raw: string } | { kind: "file"; path: string } | null {
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return { kind: "inline", raw: inline };
  const path = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) return { kind: "file", path };
  return null;
}

// Parse + validate a service-account JSON blob. `source` names where it came
// from so errors point at the right env var / file. Pure + testable.
export function parseServiceAccount(
  raw: string,
  source: string,
): ServiceAccountCredentials {
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Service-account JSON from ${source} is not valid JSON.`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      `Service-account JSON from ${source} is missing client_email or private_key.`,
    );
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

async function loadCredentials(): Promise<ServiceAccountCredentials> {
  const src = pickCredentialSource({
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
  if (!src) {
    throw new Error(
      "No service-account credentials configured — set GOOGLE_SERVICE_ACCOUNT_JSON " +
        "(inline JSON, for prod/Vercel) or GOOGLE_APPLICATION_CREDENTIALS " +
        "(path to the JSON file, e.g. .secrets/pma-sa.json for local dev).",
    );
  }
  if (src.kind === "inline") {
    return parseServiceAccount(src.raw, "GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  let raw: string;
  try {
    raw = await readFile(src.path, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read service-account key at ${src.path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return parseServiceAccount(raw, src.path);
}

// Build (or return the cached) authenticated Drive v3 client. Auth uses the
// service-account JSON referenced by GOOGLE_APPLICATION_CREDENTIALS with the
// full `drive` scope.
let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null;

export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (cachedDrive) return cachedDrive;
  const { client_email, private_key } = await loadCredentials();
  cachedAuth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: [DRIVE_SCOPE],
  });
  cachedDrive = google.drive({ version: "v3", auth: cachedAuth });
  return cachedDrive;
}

// Bearer token for raw fetches the googleapis client can't do (a revision's
// exportLinks URL is a plain authenticated GET, not a drive.* method).
async function getAccessToken(): Promise<string> {
  await getDriveClient(); // ensures cachedAuth
  const { token } = await cachedAuth!.getAccessToken();
  if (!token) throw new Error("Drive auth returned no access token.");
  return token;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

// List the (non-trashed) immediate children of a folder. Paginates internally
// so the caller gets the full listing. Safe against any folder.
export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const drive = await getDriveClient();
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: 1000,
      pageToken,
      ...SHARED_DRIVE_READ,
    });
    for (const f of res.data.files ?? []) files.push(toDriveFile(f));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Recursively list every NON-folder file under `folderId`, at any depth. Folders
// whose name is in `skipNames` are not descended into (keeps the Reports output
// folder out of the analysis scan). Folders themselves are not returned.
export async function listFolderTree(
  folderId: string,
  opts: { skipNames?: string[] } = {},
): Promise<DriveFile[]> {
  const skip = new Set(opts.skipNames ?? []);
  const out: DriveFile[] = [];
  // Carry each folder's source-relative path of ancestor names alongside its id,
  // so every file out can record which folders it sits under (#4 superseded flag).
  const stack: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
  while (stack.length > 0) {
    const { id: current, path } = stack.pop() as { id: string; path: string[] };
    for (const file of await listFolder(current)) {
      if (file.mimeType === FOLDER_MIME) {
        if (!skip.has(file.name)) stack.push({ id: file.id, path: [...path, file.name] });
      } else if (!file.name.startsWith("__pma_tmp_")) {
        // Skip transient Office-conversion copies (normally trashed at once; this
        // guards against a stray one lingering if a trash ever fails).
        out.push({ ...file, folderPath: path });
      }
    }
  }
  return out;
}

// Fetch a single file's metadata (id, name, mimeType, modifiedTime,
// headRevisionId).
export async function getFile(fileId: string): Promise<DriveFile> {
  const drive = await getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: FILE_FIELDS,
    ...SHARED_DRIVE_READ,
  });
  return toDriveFile(res.data);
}

// U12.9 — a Drive revision: id + when + who. Used to scope a run to a date
// window BY REVISION (not just the file's last modifiedTime) and to attribute
// changes to the people who revised within that window.
export type DriveRevision = {
  id: string;
  modifiedTime: string | null;
  authorName: string | null;
  // emailAddress of the revision's author (lowercased), or null when Drive does
  // not expose it. The stable identity key for org attribution.
  authorEmail: string | null;
};

// List a file's revisions (paginated). Read-only. Google COALESCES minor edits,
// so this is a coarse per-revision history (not per-keystroke). Throws bubble to
// the caller, which treats a failure as "no revision data".
export async function listRevisions(fileId: string): Promise<DriveRevision[]> {
  const drive = await getDriveClient();
  const out: DriveRevision[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.revisions.list({
      fileId,
      fields:
        "nextPageToken, revisions(id, modifiedTime, lastModifyingUser(displayName, emailAddress))",
      pageSize: 1000,
      pageToken,
    });
    for (const r of res.data.revisions ?? []) {
      out.push({
        id: r.id ?? "",
        modifiedTime: r.modifiedTime ?? null,
        // `|| null` (not `?? null`): an anonymous edit comes back with an empty
        // displayName "", which must become null so it's labelled "anonymous user".
        authorName: r.lastModifyingUser?.displayName?.trim() || null,
        authorEmail: r.lastModifyingUser?.emailAddress?.trim().toLowerCase() || null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// U5 (revision delta) — the newest revision of a NATIVE Google Doc at-or-before
// `beforeIso`, exported as plain text via the revision's exportLinks (probed
// working on the live corpus 02/07/2026: old revisions of Docs Editors files
// export fine; granularity is Google's coarse merged revisions). Returns null
// when the file has no revision that old, the revision carries no text export
// link, or the export fails — callers treat null as "no verified delta
// available" and fall back to current-content behaviour. Read-only.
export async function getNativeRevisionTextBefore(
  fileId: string,
  beforeIso: string,
): Promise<{ text: string; revisionDate: string } | null> {
  const drive = await getDriveClient();
  const res = await drive.revisions.list(
    {
      fileId,
      fields: "revisions(id, modifiedTime, exportLinks)",
      pageSize: 1000,
    },
    // U6c — a hung revisions read must fail fast (callers degrade to
    // "no verified delta"), never freeze the analysis loop.
    { timeout: 20_000 },
  );
  // revisions.list returns chronological order — take the last one ≤ cutoff.
  const revs = (res.data.revisions ?? []).filter(
    (r) => r.modifiedTime && r.modifiedTime <= beforeIso,
  );
  const rev = revs[revs.length - 1];
  const url = rev?.exportLinks?.["text/plain"];
  if (!rev?.modifiedTime || !url) return null;
  const token = await getAccessToken();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000), // U6c — never hang on the export GET
  });
  if (!resp.ok) return null;
  return { text: await resp.text(), revisionDate: rev.modifiedTime };
}

// Get the Changes-API start page token for the SOURCE folder's drive. Used to
// bootstrap incremental detection: persist this, then later call listChanges.
export async function getStartPageToken(): Promise<string> {
  const drive = await getDriveClient();
  const res = await drive.changes.getStartPageToken({
    ...SHARED_DRIVE_WRITE,
  });
  const token = res.data.startPageToken;
  if (!token) {
    throw new Error("changes.getStartPageToken returned no startPageToken.");
  }
  return token;
}

// List changes since `pageToken`. Returns the changed/removed files plus the
// token(s) to drive the next call: `nextPageToken` for more pages, and
// `newStartPageToken` on the final page (the value to checkpoint).
export async function listChanges(pageToken: string): Promise<DriveChanges> {
  const drive = await getDriveClient();
  const res = await drive.changes.list({
    pageToken,
    fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
    pageSize: 1000,
    ...SHARED_DRIVE_READ,
  });
  const changes: DriveChange[] = (res.data.changes ?? []).map((c) => ({
    fileId: c.fileId ?? null,
    removed: c.removed ?? false,
    file: c.file ? toDriveFile(c.file) : null,
  }));
  return {
    changes,
    nextPageToken: res.data.nextPageToken ?? null,
    newStartPageToken: res.data.newStartPageToken ?? null,
  };
}

// The export mimeType used to pull plain text out of each Google-native
// editable type (the only types PMA deep-analyses). Non-editable files never
// reach here.
const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

// Export a Google-native editable document's content as plain text (Docs/Slides
// → text/plain, Sheets → text/csv) via files.export. Read-only and safe against
// any folder; PMA only ever points it at Source files. Throws for a
// non-exportable mimeType so callers never silently feed binary to the model.
export async function exportText(
  fileId: string,
  sourceMimeType: string,
): Promise<string> {
  const exportMimeType = EXPORT_MIME[sourceMimeType];
  if (!exportMimeType) {
    throw new Error(
      `exportText: ${sourceMimeType} is not a Google-native editable type — nothing to export.`,
    );
  }
  const drive = await getDriveClient();
  const res = await drive.files.export(
    { fileId, mimeType: exportMimeType },
    { responseType: "text" },
  );
  // files.export returns the raw exported content as the response body.
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}

// Download a file's raw bytes as base64 (for types Gemini reads natively — PDF,
// images). Returns the bytes plus the file's own mimeType for the model part.
export async function getFileBytes(
  fileId: string,
): Promise<{ data: string; mimeType: string }> {
  const drive = await getDriveClient();
  const meta = await drive.files.get({ fileId, fields: "mimeType", ...SHARED_DRIVE_READ });
  const res = await drive.files.get(
    { fileId, alt: "media", ...SHARED_DRIVE_READ },
    { responseType: "arraybuffer" },
  );
  const data = Buffer.from(res.data as ArrayBuffer).toString("base64");
  return { data, mimeType: meta.data.mimeType ?? "application/octet-stream" };
}

// Office (docx/xlsx/pptx) has no native Gemini reader. Convert via Drive: copy
// the file into the matching Google-native type, export its text, then trash the
// temporary copy (always, even on error). No local converter, no new dependency.
const OFFICE_TO_GOOGLE: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "application/vnd.google-apps.presentation",
};

export async function copyAsGoogleAndExportText(
  fileId: string,
  sourceMimeType: string,
): Promise<string> {
  const target = OFFICE_TO_GOOGLE[sourceMimeType];
  if (!target) {
    throw new Error(
      `copyAsGoogleAndExportText: ${sourceMimeType} has no Google-native target.`,
    );
  }
  const drive = await getDriveClient();
  // Service accounts have NO personal Drive storage, so a copy into My Drive
  // fails with "storage quota exceeded". Create the temp copy inside the Trinno
  // Shared Drive (PLAN_IMPORT_DRIVE_ROOT), where files are owned by the drive,
  // not the SA — regardless of where the source file lives.
  const scratch = process.env.PLAN_IMPORT_DRIVE_ROOT?.trim();
  const copy = await drive.files.copy({
    fileId,
    requestBody: {
      mimeType: target,
      name: `__pma_tmp_${fileId}`,
      ...(scratch ? { parents: [scratch] } : {}),
    },
    fields: "id",
    ...SHARED_DRIVE_WRITE,
  });
  const tmpId = copy.data.id;
  if (!tmpId) throw new Error("copyAsGoogleAndExportText: copy returned no id.");
  try {
    return await exportText(tmpId, target);
  } finally {
    await trashFile(tmpId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// WRITE  (callers must only target the OUTPUT folder — never the Source folder)
// ---------------------------------------------------------------------------

// Create a sub-folder under `parentId` and return its metadata.
export async function createFolder(
  name: string,
  parentId: string,
): Promise<DriveFile> {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: FILE_FIELDS,
    ...SHARED_DRIVE_WRITE,
  });
  return toDriveFile(res.data);
}

// Upload an arbitrary file (recap JSON, etc.) into `parentId`.
export async function uploadFile(input: UploadFileInput): Promise<DriveFile> {
  const drive = await getDriveClient();
  const body =
    input.body instanceof Readable
      ? input.body
      : Readable.from(
          typeof input.body === "string"
            ? Buffer.from(input.body)
            : Buffer.from(input.body),
        );
  const res = await drive.files.create({
    requestBody: { name: input.name, parents: [input.parentId] },
    media: { mimeType: input.mimeType, body },
    fields: FILE_FIELDS,
    ...SHARED_DRIVE_WRITE,
  });
  return toDriveFile(res.data);
}

// Create a native Google Doc from HTML `content` under `parentId`. Uploading
// text/html with the Google Doc target mimeType makes Drive convert it, carrying
// formatting (e.g. <b> author names — U12.6). Returns the new file id plus its
// webViewLink (the report link the Analysis tab will surface).
export async function createDoc(
  input: CreateDocInput,
): Promise<{ id: string; webViewLink: string }> {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: input.name,
      parents: [input.parentId],
      mimeType: "application/vnd.google-apps.document",
    },
    media: { mimeType: "text/html", body: Readable.from(Buffer.from(input.content)) },
    fields: "id, webViewLink",
    ...SHARED_DRIVE_WRITE,
  });
  const id = res.data.id;
  if (!id) throw new Error("createDoc: Drive returned no file id.");
  return { id, webViewLink: res.data.webViewLink ?? "" };
}

// Create a native Google Doc from raw .docx bytes under `parentId`. Uploading
// the Word file with the Google Doc target mimeType makes Drive convert it on
// upload (no .DOCX badge), preserving the template's styling — the same path the
// manual seeders use. Returns the new file id plus its webViewLink.
export async function createDocFromDocx(input: {
  name: string;
  parentId: string;
  docx: Buffer | Uint8Array;
}): Promise<{ id: string; webViewLink: string }> {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: input.name,
      parents: [input.parentId],
      mimeType: "application/vnd.google-apps.document",
    },
    media: {
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Readable.from(Buffer.from(input.docx)),
    },
    fields: "id, webViewLink",
    ...SHARED_DRIVE_WRITE,
  });
  const id = res.data.id;
  if (!id) throw new Error("createDocFromDocx: Drive returned no file id.");
  return { id, webViewLink: res.data.webViewLink ?? "" };
}

// Move a file to the trash (soft delete). Used to clean up temp/smoke files and
// to reflect removed deliverables. Only ever call against the Output folder.
export async function trashFile(fileId: string): Promise<void> {
  const drive = await getDriveClient();
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    ...SHARED_DRIVE_WRITE,
  });
}

// Reset the cached client. Test-only escape hatch; not used in the app path.
export function __resetDriveClientForTests(): void {
  cachedDrive = null;
}
