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
const FILE_FIELDS = "id, name, mimeType, modifiedTime, headRevisionId, version";

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
    headRevisionId: f.headRevisionId ?? null,
    version: f.version ?? null,
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
export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (cachedDrive) return cachedDrive;
  const { client_email, private_key } = await loadCredentials();
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: [DRIVE_SCOPE],
  });
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
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

// Create a native Google Doc from plain-text `content` under `parentId`.
// Uploading text/plain with the Google Doc target mimeType makes Drive convert
// it. Returns the new file id plus its webViewLink (the report link the
// Analysis tab will surface).
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
    media: { mimeType: "text/plain", body: Readable.from(Buffer.from(input.content)) },
    fields: "id, webViewLink",
    ...SHARED_DRIVE_WRITE,
  });
  const id = res.data.id;
  if (!id) throw new Error("createDoc: Drive returned no file id.");
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
