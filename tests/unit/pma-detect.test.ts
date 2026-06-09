import { describe, it, expect, vi, beforeEach } from "vitest";

// U5 detect — Drive Changes API over the SOURCE folder + runtime categorization.
// The real Drive client (U1a) is mocked so this verifies pure detection logic
// with NO service-account credentials. Each test sets the three read methods
// detect() relies on: listFolder (scope oracle), getStartPageToken (bootstrap
// checkpoint) and listChanges (incremental feed).

// detect.ts carries an `import "server-only"` guard (it must never reach the
// client). That bare specifier isn't resolvable in the node test env, so stub
// it — the guard's job is bundler-time, not runtime.
vi.mock("server-only", () => ({}));

const listFolder = vi.fn();
const getStartPageToken = vi.fn();
const listChanges = vi.fn();
const listRevisions = vi.fn();

vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: (...a: unknown[]) => listFolder(...a),
  getStartPageToken: (...a: unknown[]) => getStartPageToken(...a),
  listChanges: (...a: unknown[]) => listChanges(...a),
  listRevisions: (...a: unknown[]) => listRevisions(...a),
}));

import {
  detect,
  categorize,
  extractDriveFileId,
} from "@/lib/pma/detect";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  headRevisionId: string | null;
  version: string | null;
  lastModifiedBy: string | null;
};

const doc = (id: string, name = id): DriveFile => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: "2026-06-07T10:00:00Z",
  headRevisionId: null, // Google docs have no headRevisionId …
  version: "v1", // … the monotonic `version` is the gate key
  lastModifiedBy: "Mario Rossi",
});
const pdf = (id: string, name = id): DriveFile => ({
  id,
  name,
  mimeType: "application/pdf",
  modifiedTime: "2026-06-07T10:00:00Z",
  headRevisionId: "rev1",
  version: "v1",
  lastModifiedBy: "Mario Rossi",
});

const SOURCE = "SRC_FOLDER";

beforeEach(() => {
  listFolder.mockReset();
  getStartPageToken.mockReset();
  listChanges.mockReset();
  listRevisions.mockReset();
  // Default: no revision data → window mode falls back to modifiedTime membership.
  listRevisions.mockResolvedValue([]);
});

describe("categorize", () => {
  it("maps Google-native editable mimeTypes to 'editable'", () => {
    expect(categorize("application/vnd.google-apps.document")).toBe("editable");
    expect(categorize("application/vnd.google-apps.spreadsheet")).toBe("editable");
    expect(categorize("application/vnd.google-apps.presentation")).toBe("editable");
  });
  it("maps everything else to 'non_mod'", () => {
    expect(categorize("application/pdf")).toBe("non_mod");
    expect(categorize("image/png")).toBe("non_mod");
    expect(categorize("application/vnd.google-apps.folder")).toBe("non_mod");
    expect(categorize("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("non_mod");
    expect(categorize("")).toBe("non_mod");
  });
});

describe("extractDriveFileId", () => {
  it("parses the common Drive URL shapes", () => {
    expect(extractDriveFileId("https://drive.google.com/drive/folders/ABC123")).toBe("ABC123");
    expect(extractDriveFileId("https://drive.google.com/file/d/FILE_9/view?usp=sharing")).toBe("FILE_9");
    expect(extractDriveFileId("https://docs.google.com/document/d/DOC_7/edit")).toBe("DOC_7");
    expect(extractDriveFileId("https://docs.google.com/spreadsheets/d/SHEET_1/edit#gid=0")).toBe("SHEET_1");
    expect(extractDriveFileId("https://drive.google.com/open?id=OPEN_2")).toBe("OPEN_2");
  });
  it("returns null for non-Drive URLs", () => {
    expect(extractDriveFileId("https://example.com/whatever")).toBeNull();
    expect(extractDriveFileId("not a url")).toBeNull();
  });
});

describe("detect — bootstrap (no page token)", () => {
  it("seeds from a full folder listing and checkpoints the start token", async () => {
    listFolder.mockResolvedValue([doc("A"), pdf("B")]);
    getStartPageToken.mockResolvedValue("TOK1");

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: null,
      deliverableLinks: [],
    });

    expect(res.bootstrapped).toBe(true);
    expect(res.newPageToken).toBe("TOK1");
    expect(listChanges).not.toHaveBeenCalled();
    expect(listFolder).toHaveBeenCalledWith(SOURCE);
    expect(res.files).toHaveLength(2);

    const a = res.files.find((f) => f.fileId === "A")!;
    const b = res.files.find((f) => f.fileId === "B")!;
    expect(a.kind).toBe("editable");
    expect(a.changeType).toBe("added_or_edited");
    expect(a.version).toBe("v1");
    expect(b.kind).toBe("non_mod");
  });
});

describe("detect — incremental", () => {
  it("scopes adds/edits to the source folder and excludes out-of-scope (Output) churn", async () => {
    // Source folder currently holds A (edited) and B. The change feed also
    // reports X — one of our own Output-folder recap writes — which must be
    // dropped because X is not in the source listing.
    listFolder.mockResolvedValue([doc("A"), pdf("B")]);
    listChanges.mockResolvedValue({
      changes: [
        { fileId: "A", removed: false, file: doc("A") },
        { fileId: "X", removed: false, file: pdf("X") },
      ],
      nextPageToken: null,
      newStartPageToken: "T1",
    });

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: "T0",
      deliverableLinks: [],
    });

    expect(res.bootstrapped).toBe(false);
    expect(res.newPageToken).toBe("T1");
    expect(res.files.map((f) => f.fileId)).toEqual(["A"]);
    expect(res.files[0].changeType).toBe("added_or_edited");
  });

  it("emits the current source version, not the (stale) feed version", async () => {
    const current = { ...doc("A"), version: "v9" };
    listFolder.mockResolvedValue([current]);
    listChanges.mockResolvedValue({
      changes: [{ fileId: "A", removed: false, file: { ...doc("A"), version: "v2" } }],
      nextPageToken: null,
      newStartPageToken: "T1",
    });

    const res = await detect({ sourceFolderId: SOURCE, pageToken: "T0", deliverableLinks: [] });
    expect(res.files[0].version).toBe("v9");
  });

  it("flags removed source files (removed in feed, absent from listing)", async () => {
    listFolder.mockResolvedValue([doc("A")]);
    listChanges.mockResolvedValue({
      changes: [
        { fileId: "A", removed: false, file: doc("A") },
        { fileId: "R", removed: true, file: null },
      ],
      nextPageToken: null,
      newStartPageToken: "T1",
    });

    const res = await detect({ sourceFolderId: SOURCE, pageToken: "T0", deliverableLinks: [] });
    const r = res.files.find((f) => f.fileId === "R")!;
    expect(r.changeType).toBe("removed");
    expect(r.kind).toBeNull();
    expect(res.files.find((f) => f.fileId === "A")!.changeType).toBe("added_or_edited");
  });

  it("walks every change page to reach the final newStartPageToken", async () => {
    listFolder.mockResolvedValue([doc("A"), doc("C")]);
    listChanges
      .mockResolvedValueOnce({
        changes: [{ fileId: "A", removed: false, file: doc("A") }],
        nextPageToken: "P2",
        newStartPageToken: null,
      })
      .mockResolvedValueOnce({
        changes: [{ fileId: "C", removed: false, file: doc("C") }],
        nextPageToken: null,
        newStartPageToken: "T1",
      });

    const res = await detect({ sourceFolderId: SOURCE, pageToken: "T0", deliverableLinks: [] });
    expect(listChanges).toHaveBeenNthCalledWith(1, "T0");
    expect(listChanges).toHaveBeenNthCalledWith(2, "P2");
    expect(res.newPageToken).toBe("T1");
    expect(res.files.map((f) => f.fileId).sort()).toEqual(["A", "C"]);
  });

  it("dedupes a fileId that appears in multiple change pages", async () => {
    listFolder.mockResolvedValue([doc("A")]);
    listChanges
      .mockResolvedValueOnce({
        changes: [{ fileId: "A", removed: false, file: doc("A") }],
        nextPageToken: "P2",
        newStartPageToken: null,
      })
      .mockResolvedValueOnce({
        changes: [{ fileId: "A", removed: false, file: doc("A") }],
        nextPageToken: null,
        newStartPageToken: "T1",
      });

    const res = await detect({ sourceFolderId: SOURCE, pageToken: "T0", deliverableLinks: [] });
    expect(res.files.filter((f) => f.fileId === "A")).toHaveLength(1);
  });
});

describe("detect — window mode (U12.2)", () => {
  const WIN = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-31T23:59:59.999Z" };

  it("keeps only files modified within [start,end]; no change feed, null token", async () => {
    const inWin = { ...doc("A"), modifiedTime: "2026-01-15T10:00:00Z" };
    const before = { ...doc("B"), modifiedTime: "2025-12-20T10:00:00Z" };
    const after = { ...pdf("C"), modifiedTime: "2026-02-05T10:00:00Z" };
    listFolder.mockResolvedValue([inWin, before, after]);

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: null,
      deliverableLinks: [],
      window: WIN,
    });

    expect(listChanges).not.toHaveBeenCalled();
    expect(getStartPageToken).not.toHaveBeenCalled();
    expect(res.newPageToken).toBeNull();
    expect(res.bootstrapped).toBe(false);
    expect(res.files.map((f) => f.fileId)).toEqual(["A"]);
    expect(res.files[0].changeType).toBe("added_or_edited");
  });

  it("includes non_mod files in-window (analyze filters to editable later)", async () => {
    const editableIn = { ...doc("A"), modifiedTime: "2026-01-10T00:00:00Z" };
    const pdfIn = { ...pdf("P"), modifiedTime: "2026-01-12T00:00:00Z" };
    listFolder.mockResolvedValue([editableIn, pdfIn]);

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: null,
      deliverableLinks: [],
      window: WIN,
    });

    expect(res.files.map((f) => f.fileId).sort()).toEqual(["A", "P"]);
    expect(res.files.find((f) => f.fileId === "P")!.kind).toBe("non_mod");
  });

  it("includes a file last edited AFTER the window if it has a revision IN it, and attributes only the window's authors (U12.9)", async () => {
    // File's last edit is in March (outside the Jan window) — but it was also
    // revised in January. The exact "I edit Feb, Paolo edits Mar, I ask Feb" case.
    const f = { ...doc("A"), modifiedTime: "2026-03-10T00:00:00Z" };
    listFolder.mockResolvedValue([f]);
    listRevisions.mockResolvedValue([
      { id: "r1", modifiedTime: "2026-01-15T00:00:00Z", authorName: "Luca" },
      { id: "r2", modifiedTime: "2026-03-10T00:00:00Z", authorName: "Paolo" },
    ]);

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: null,
      deliverableLinks: [],
      window: WIN,
    });

    expect(res.files.map((x) => x.fileId)).toEqual(["A"]); // included despite later edit
    expect(res.files[0].windowAuthors).toEqual(["Luca"]); // ONLY the Jan reviser, not Paolo
  });
});

describe("detect — deliverable cross-ref", () => {
  it("tags changed files that match a card-scope deliverable link", async () => {
    listFolder.mockResolvedValue([doc("A"), pdf("B")]);
    getStartPageToken.mockResolvedValue("TOK1");

    const res = await detect({
      sourceFolderId: SOURCE,
      pageToken: null,
      deliverableLinks: [
        { id: "link-1", url: "https://docs.google.com/document/d/A/edit" },
        { id: "link-2", url: "https://example.com/not-a-drive-file" },
      ],
    });

    const a = res.files.find((f) => f.fileId === "A")!;
    const b = res.files.find((f) => f.fileId === "B")!;
    expect(a.isDeliverable).toBe(true);
    expect(a.cardLinkId).toBe("link-1");
    expect(b.isDeliverable).toBe(false);
    expect(b.cardLinkId).toBeNull();
  });
});
