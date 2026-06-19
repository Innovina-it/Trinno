import { describe, it, expect, vi, beforeEach } from "vitest";

// PMA project-context reader. The Drive client + content extractor are mocked so
// this verifies the pure gather/concat/cap logic with no service-account creds.

vi.mock("server-only", () => ({}));

const listFolder = vi.fn();
const listFolderTree = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: (...a: unknown[]) => listFolder(...a),
  listFolderTree: (...a: unknown[]) => listFolderTree(...a),
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

import { getProjectContext, MAX_CONTEXT_CHARS } from "@/lib/pma/context";

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
