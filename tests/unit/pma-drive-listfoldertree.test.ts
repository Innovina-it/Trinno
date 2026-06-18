import { describe, it, expect, vi, beforeEach } from "vitest";

// drive.ts carries `import "server-only"`; stub it for the node test env.
vi.mock("server-only", () => ({}));

// listFolderTree lives IN drive.ts and calls the module-internal listFolder, so
// mocking the export would not intercept it. Mock at the googleapis boundary
// instead: getDriveClient's `google.drive(...)` returns our fake, so BOTH the
// real listFolder and the real listFolderTree use it. GoogleAuth is a no-op.
const list = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {}, GoogleAuth: class {} },
    drive: () => ({ files: { list } }),
  },
}));

import { listFolderTree, __resetDriveClientForTests } from "@/lib/pma/clients/drive";

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const f = (id: string, name: string, mimeType = DOC) => ({ id, name, mimeType });

// tree: folderId -> its immediate children (raw googleapis file shape)
function serve(tree: Record<string, ReturnType<typeof f>[]>) {
  list.mockImplementation(async ({ q }: { q: string }) => {
    const id = /'([^']+)' in parents/.exec(q)?.[1] ?? "";
    return { data: { files: tree[id] ?? [], nextPageToken: undefined } };
  });
}

describe("listFolderTree", () => {
  beforeEach(() => {
    __resetDriveClientForTests();
    list.mockReset();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "x@x.iam.gserviceaccount.com",
      private_key: "k",
    });
  });

  it("returns files at every depth and recurses into subfolders", async () => {
    serve({
      root: [f("a", "a.doc"), f("sub", "WP1", FOLDER)],
      sub: [f("b", "b.doc")],
    });
    const out = await listFolderTree("root");
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("skips subfolders whose name is in skipNames", async () => {
    serve({
      root: [f("a", "a.doc"), f("rep", "Reports", FOLDER)],
      rep: [f("r", "old-report.doc")],
    });
    const out = await listFolderTree("root", { skipNames: ["Reports"] });
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });
});
