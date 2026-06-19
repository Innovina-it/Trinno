import { describe, it, expect, vi, beforeEach } from "vitest";

// PMA project-context reader. The Drive client + content extractor are mocked so
// this verifies the pure gather/concat/cap logic with no service-account creds.

vi.mock("server-only", () => ({}));

const listFolder = vi.fn();
const listFolderTree = vi.fn();
const getFileBytes = vi.fn();
const uploadFile = vi.fn();
const trashFile = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: (...a: unknown[]) => listFolder(...a),
  listFolderTree: (...a: unknown[]) => listFolderTree(...a),
  getFileBytes: (...a: unknown[]) => getFileBytes(...a),
  uploadFile: (...a: unknown[]) => uploadFile(...a),
  trashFile: (...a: unknown[]) => trashFile(...a),
}));

const generateStructured = vi.fn();
vi.mock("@/lib/pma/clients/gemini", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
}));

const getAnalyzableContent = vi.fn();
// isAnalyzable: real-ish — Google-native + Office + PDF/image are analyzable.
vi.mock("@/lib/pma/content", () => ({
  getAnalyzableContent: (...a: unknown[]) => getAnalyzableContent(...a),
  isAnalyzable: (m: string) =>
    m.startsWith("application/vnd.google-apps.") ||
    m.startsWith("application/vnd.openxmlformats-") ||
    m === "application/pdf" ||
    m.startsWith("image/"),
}));

import { getProjectContext, getProjectBrief, MAX_CONTEXT_CHARS } from "@/lib/pma/context";

const OUT = "out-folder";
// base64 of a {fingerprint, brief} cache JSON.
const cacheJson = (fingerprint: Record<string, string>, brief: string) => ({
  data: Buffer.from(JSON.stringify({ fingerprint, brief })).toString("base64"),
  mimeType: "application/json",
});

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const SOURCE = "SRC";

const file = (id: string, name: string, mimeType = DOC) => ({
  id,
  name,
  mimeType,
  modifiedTime: null,
  createdTime: null,
  headRevisionId: null,
  version: "1",
  lastModifiedBy: null,
});

beforeEach(() => {
  listFolder.mockReset();
  listFolderTree.mockReset();
  getFileBytes.mockReset();
  uploadFile.mockReset();
  trashFile.mockReset();
  generateStructured.mockReset();
  getAnalyzableContent.mockReset();
});

describe("getProjectContext", () => {
  it("returns null when there is no Context folder", async () => {
    listFolder.mockResolvedValue([file("d", "Documents", FOLDER)]);
    expect(await getProjectContext(SOURCE)).toBeNull();
    expect(listFolderTree).not.toHaveBeenCalled();
  });

  it("concatenates the text of the Context folder's docs with name headers", async () => {
    listFolder.mockResolvedValue([file("ctx", "Context", FOLDER)]);
    listFolderTree.mockResolvedValue([file("a", "Brief"), file("b", "Glossary")]);
    getAnalyzableContent.mockImplementation(async (id: string) => ({
      text: id === "a" ? "Project goals here." : "Term definitions here.",
    }));

    const out = await getProjectContext(SOURCE);
    expect(listFolderTree).toHaveBeenCalledWith("ctx");
    expect(out).toContain("### Brief");
    expect(out).toContain("Project goals here.");
    expect(out).toContain("### Glossary");
    expect(out).toContain("Term definitions here.");
  });

  it("skips binary (PDF/image) docs in v1 and unreadable files, never throws", async () => {
    listFolder.mockResolvedValue([file("ctx", "Context", FOLDER)]);
    listFolderTree.mockResolvedValue([
      file("p", "Grant.pdf", "application/pdf"), // binary → {file}, skipped
      file("z", "Archive", "application/zip"), // not analyzable → skipped
      file("x", "Broken"), // throws → skipped
      file("ok", "Notes"), // good text
    ]);
    getAnalyzableContent.mockImplementation(async (id: string) => {
      if (id === "p") return { file: { mimeType: "application/pdf", data: "AAAA" } };
      if (id === "x") throw new Error("export failed");
      return { text: "Useful note." };
    });

    const out = await getProjectContext(SOURCE);
    expect(out).toBe("### Notes\nUseful note.");
  });

  it("returns null when the Context folder yields no text", async () => {
    listFolder.mockResolvedValue([file("ctx", "Context", FOLDER)]);
    listFolderTree.mockResolvedValue([file("e", "Empty")]);
    getAnalyzableContent.mockResolvedValue({ text: "   " }); // whitespace only
    expect(await getProjectContext(SOURCE)).toBeNull();
  });

  it("caps the concatenated context at MAX_CONTEXT_CHARS", async () => {
    listFolder.mockResolvedValue([file("ctx", "Context", FOLDER)]);
    listFolderTree.mockResolvedValue([file("big", "Big"), file("more", "More")]);
    getAnalyzableContent.mockResolvedValue({ text: "x".repeat(MAX_CONTEXT_CHARS) });
    const out = await getProjectContext(SOURCE);
    expect(out!.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
});

describe("getProjectBrief (cached distillation)", () => {
  // gatherContext finds the Context folder under source, then lists its files.
  // listFolder is called twice: once for the source (find Context), once for the
  // output (find the cache). Route by folder id.
  const wireContext = (briefDocText = "Project goals and glossary.") => {
    listFolder.mockImplementation(async (id: string) =>
      id === SOURCE ? [file("ctx", "Context", FOLDER)] : [],
    );
    listFolderTree.mockResolvedValue([{ ...file("a", "Brief"), version: "v1" }]);
    getAnalyzableContent.mockResolvedValue({ text: briefDocText });
  };

  it("returns null when there is no Context folder", async () => {
    listFolder.mockResolvedValue([]); // no Context child anywhere
    expect(await getProjectBrief({ sourceFolderId: SOURCE, outputFolderId: OUT })).toBeNull();
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("reuses the cached brief when the fingerprint matches (no distill, no write)", async () => {
    wireContext();
    // cache in the output folder with the SAME fingerprint {a: v1}
    listFolder.mockImplementation(async (id: string) =>
      id === SOURCE
        ? [file("ctx", "Context", FOLDER)]
        : [file("cache", "_context-brief.json", "application/json")],
    );
    getFileBytes.mockResolvedValue(cacheJson({ a: "v1" }, "CACHED BRIEF"));

    const out = await getProjectBrief({ sourceFolderId: SOURCE, outputFolderId: OUT });
    expect(out).toBe("CACHED BRIEF");
    expect(generateStructured).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("distills and writes the cache when Context changed (fingerprint miss)", async () => {
    wireContext();
    listFolder.mockImplementation(async (id: string) =>
      id === SOURCE
        ? [file("ctx", "Context", FOLDER)]
        : [file("cache", "_context-brief.json", "application/json")],
    );
    getFileBytes.mockResolvedValue(cacheJson({ a: "v0" }, "STALE BRIEF")); // old version
    generateStructured.mockResolvedValue({ brief: "FRESH BRIEF" });
    uploadFile.mockResolvedValue(file("new", "_context-brief.json", "application/json"));

    const out = await getProjectBrief({ sourceFolderId: SOURCE, outputFolderId: OUT });
    expect(out).toBe("FRESH BRIEF");
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured.mock.calls[0][0].model).toBe("gemini-3.5-flash");
    // wrote the refreshed cache and trashed the stale one
    const up = uploadFile.mock.calls[0][0];
    expect(up.name).toBe("_context-brief.json");
    expect(up.parentId).toBe(OUT);
    expect(JSON.parse(up.body)).toEqual({ fingerprint: { a: "v1" }, brief: "FRESH BRIEF" });
    expect(trashFile).toHaveBeenCalledWith("cache");
  });

  it("distills when there is no cache yet, and writes one", async () => {
    wireContext();
    generateStructured.mockResolvedValue({ brief: "FIRST BRIEF" });
    uploadFile.mockResolvedValue(file("new", "_context-brief.json", "application/json"));

    const out = await getProjectBrief({ sourceFolderId: SOURCE, outputFolderId: OUT });
    expect(out).toBe("FIRST BRIEF");
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(trashFile).not.toHaveBeenCalled(); // nothing to replace
  });

  it("falls back to the raw text when distillation fails (run never breaks)", async () => {
    wireContext("Raw context text.");
    generateStructured.mockRejectedValue(new Error("Gemini down"));

    const out = await getProjectBrief({ sourceFolderId: SOURCE, outputFolderId: OUT });
    expect(out).toBe("### Brief\nRaw context text."); // the raw concatenated section
    expect(uploadFile).not.toHaveBeenCalled(); // no cache written on failure
  });
});
