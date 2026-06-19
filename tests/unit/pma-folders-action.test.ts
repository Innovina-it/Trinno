import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const provision = vi.fn();
const upsert = vi.fn();
const getRole = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: () => Promise.resolve({ id: "u1" }),
  getSessionToken: () => Promise.resolve("tok"),
}));
vi.mock("@/lib/pma/provision", () => ({
  provisionProjectFolders: (...a: unknown[]) => provision(...a),
}));
vi.mock("@/actions/links", () => ({
  upsertWorkspaceLinkImpl: (...a: unknown[]) => upsert(...a),
}));
vi.mock("@/lib/queries/workspaces", () => ({
  getWorkspaceRole: (...a: unknown[]) => getRole(...a),
  getWorkspace: () => Promise.resolve({ id: "w1", name: "AEGIS" }),
}));
vi.mock("@/lib/pma/detect", () => ({
  extractDriveFileId: (u: string) => /\/folders\/([^/]+)/.exec(u)?.[1] ?? null,
}));
const createFolderMock = vi.fn();
const listFolderMock = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  createFolder: (...a: unknown[]) => createFolderMock(...a),
  listFolder: (...a: unknown[]) => listFolderMock(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

const url = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const FOLDER = "application/vnd.google-apps.folder";

describe("setWorkspaceDriveFolderAction (auto)", () => {
  beforeEach(() => {
    provision.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue(undefined);
    getRole.mockReset();
    getRole.mockResolvedValue("owner");
    process.env.PLAN_IMPORT_DRIVE_ROOT = "root";
  });

  it("provisions and sets both source + reports links", async () => {
    provision.mockResolvedValue({ projectFolderId: "p", documentsFolderId: "d", reportsFolderId: "r" });
    const res = await setWorkspaceDriveFolderAction({ workspaceId: "w1", mode: "auto" });
    expect(res).toEqual({ ok: true });
    expect(provision).toHaveBeenCalledWith("root", "AEGIS");
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("d"), purpose: "source" });
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("r"), purpose: "reports" });
  });

  it("rejects a non owner/admin", async () => {
    getRole.mockResolvedValue("member");
    const res = await setWorkspaceDriveFolderAction({ workspaceId: "w1", mode: "auto" });
    expect(res.ok).toBe(false);
    expect(provision).not.toHaveBeenCalled();
  });
});

describe("setWorkspaceDriveFolderAction (manual)", () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue(undefined);
    getRole.mockReset();
    getRole.mockResolvedValue("admin");
    createFolderMock.mockReset();
    listFolderMock.mockReset();
  });

  it("creates Reports + Context children in the pasted folder, links source + reports", async () => {
    listFolderMock.mockResolvedValue([]); // empty pasted folder — nothing to reuse
    createFolderMock.mockImplementation(async (name: string) => ({ id: `${name}-id`, name, mimeType: FOLDER }));
    const res = await setWorkspaceDriveFolderAction({
      workspaceId: "w1",
      mode: "manual",
      folderLink: url("pasted"),
    });
    expect(res).toEqual({ ok: true });
    expect(createFolderMock).toHaveBeenCalledWith("Reports", "pasted");
    expect(createFolderMock).toHaveBeenCalledWith("Context", "pasted");
    // The pasted folder IS the source; reports link points at the new Reports child.
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("pasted"), purpose: "source" });
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("Reports-id"), purpose: "reports" });
  });

  it("reuses existing Reports + Context (creates neither)", async () => {
    listFolderMock.mockResolvedValue([
      { id: "r", name: "Reports", mimeType: FOLDER },
      { id: "c", name: "Context", mimeType: FOLDER },
    ]);
    const res = await setWorkspaceDriveFolderAction({
      workspaceId: "w1",
      mode: "manual",
      folderLink: url("pasted"),
    });
    expect(res).toEqual({ ok: true });
    expect(createFolderMock).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("r"), purpose: "reports" });
  });
});
