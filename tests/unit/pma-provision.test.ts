import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const listFolder = vi.fn();
const createFolder = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: (...a: unknown[]) => listFolder(...a),
  createFolder: (...a: unknown[]) => createFolder(...a),
}));

import { provisionProjectFolders } from "@/lib/pma/provision";

const FOLDER = "application/vnd.google-apps.folder";
const fold = (id: string, name: string) => ({
  id,
  name,
  mimeType: FOLDER,
  modifiedTime: null,
  createdTime: null,
  headRevisionId: null,
  version: "1",
  lastModifiedBy: null,
});

describe("provisionProjectFolders", () => {
  beforeEach(() => {
    listFolder.mockReset();
    createFolder.mockReset();
  });

  it("creates project + Documents + Reports when none exist", async () => {
    listFolder.mockResolvedValue([]); // nothing exists anywhere
    createFolder.mockImplementation(async (name: string) => fold(`${name}-id`, name));
    const r = await provisionProjectFolders("root", "AEGIS");
    expect(r).toEqual({
      projectFolderId: "AEGIS-id",
      documentsFolderId: "Documents-id",
      reportsFolderId: "Reports-id",
    });
    expect(createFolder).toHaveBeenCalledWith("AEGIS", "root");
    expect(createFolder).toHaveBeenCalledWith("Documents", "AEGIS-id");
    expect(createFolder).toHaveBeenCalledWith("Reports", "AEGIS-id");
  });

  it("reuses existing folders (idempotent)", async () => {
    listFolder.mockImplementation(async (id: string) => {
      if (id === "root") return [fold("p", "AEGIS")];
      if (id === "p") return [fold("d", "Documents"), fold("r", "Reports")];
      return [];
    });
    const r = await provisionProjectFolders("root", "AEGIS");
    expect(r).toEqual({ projectFolderId: "p", documentsFolderId: "d", reportsFolderId: "r" });
    expect(createFolder).not.toHaveBeenCalled();
  });
});
