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

vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: (...a: unknown[]) => listFolder(...a),
  getStartPageToken: (...a: unknown[]) => getStartPageToken(...a),
  listChanges: (...a: unknown[]) => listChanges(...a),
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
};

const doc = (id: string, name = id): DriveFile => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: "2026-06-07T10:00:00Z",
  headRevisionId: "rev1",
});
const pdf = (id: string, name = id): DriveFile => ({
  id,
  name,
  mimeType: "application/pdf",
  modifiedTime: "2026-06-07T10:00:00Z",
  headRevisionId: "rev1",
});

const SOURCE = "SRC_FOLDER";

beforeEach(() => {
  listFolder.mockReset();
  getStartPageToken.mockReset();
  listChanges.mockReset();
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
    expect(a.headRevisionId).toBe("rev1");
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
    const current = { ...doc("A"), headRevisionId: "rev9" };
    listFolder.mockResolvedValue([current]);
    listChanges.mockResolvedValue({
      changes: [{ fileId: "A", removed: false, file: { ...doc("A"), headRevisionId: "rev2" } }],
      nextPageToken: null,
      newStartPageToken: "T1",
    });

    const res = await detect({ sourceFolderId: SOURCE, pageToken: "T0", deliverableLinks: [] });
    expect(res.files[0].headRevisionId).toBe("rev9");
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
