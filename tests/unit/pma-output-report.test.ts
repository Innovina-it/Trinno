import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createDoc = vi.fn().mockResolvedValue({ id: "doc1", webViewLink: "https://docs/doc1" });
const createFolder = vi.fn();
const listFolder = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  createFolder: (...a: unknown[]) => createFolder(...a),
  listFolder: (...a: unknown[]) => listFolder(...a),
  trashFile: (...a: unknown[]) => a,
}));

import { createReport } from "@/lib/pma/output";

describe("createReport", () => {
  it("writes the Doc directly into the output (Reports) folder, no subfolder", async () => {
    const r = await createReport("reportsFolder", { name: "Report", content: "<h1>x</h1>" });
    expect(createDoc).toHaveBeenCalledWith({
      name: "Report",
      parentId: "reportsFolder",
      content: "<h1>x</h1>",
    });
    expect(createFolder).not.toHaveBeenCalled();
    expect(listFolder).not.toHaveBeenCalled();
    expect(r).toEqual({ id: "doc1", webViewLink: "https://docs/doc1" });
  });
});
