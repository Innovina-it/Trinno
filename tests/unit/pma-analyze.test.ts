import { describe, it, expect, vi, beforeEach } from "vitest";

// U6 analyze — version gate (C) + per-editable-file Flash recap (D). The Drive
// content reader, Gemini client and registry read are all mocked so this
// verifies orchestration logic with no creds and no network. `Type` from
// @google/genai stays real (the response schema is built from it). U12.1: the
// recap is returned in-memory (reconcile persists it) — analyze writes nothing.
vi.mock("server-only", () => ({}));

const exportText = vi.fn();
const generateStructured = vi.fn();
const getRegistryEntry = vi.fn();

vi.mock("@/lib/pma/clients/drive", () => ({ exportText: (...a: unknown[]) => exportText(...a) }));
vi.mock("@/lib/pma/clients/gemini", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));
vi.mock("@/lib/pma/registry", () => ({ getRegistryEntry: (...a: unknown[]) => getRegistryEntry(...a) }));

import { analyze } from "@/lib/pma/analyze";
import type { DetectedFile } from "@/lib/pma/detect";

const WS = "ws-1";
const OUT = "out-folder";

// `rev` populates the Drive `version` gate key (Google docs have no
// headRevisionId — that's the whole reason the gate uses `version`).
const editable = (id: string, rev: string, over: Partial<DetectedFile> = {}): DetectedFile => ({
  fileId: id,
  name: id,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: "2026-06-08T10:00:00Z",
  headRevisionId: null,
  version: rev,
  lastModifiedBy: "Mario Rossi",
  kind: "editable",
  isDeliverable: false,
  cardLinkId: null,
  changeType: "added_or_edited",
  ...over,
});

const RECAP = {
  additions: ["a"],
  edits: ["e"],
  structural_changes: [],
  one_line_summary: "did stuff",
  recap: ["line"],
  quality_judgment: "good",
  importance: "medium",
  risk_flags: [],
  is_deliverable: false,
};

beforeEach(() => {
  exportText.mockReset();
  generateStructured.mockReset();
  getRegistryEntry.mockReset();
  getRegistryEntry.mockResolvedValue(null);
  exportText.mockResolvedValue("document body text");
  generateStructured.mockResolvedValue({ ...RECAP });
});

describe("analyze — version gate (C)", () => {
  it("skips a file whose headRevisionId equals the registry's last_version", async () => {
    // The registry row arrives from supabase in snake_case at runtime.
    getRegistryEntry.mockResolvedValue({ last_version: "rev1" } as never);

    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });

    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("skipped");
    expect(exportText).not.toHaveBeenCalled();
    expect(generateStructured).not.toHaveBeenCalled();
    expect(res[0].recap).toBeNull();
  });

  it("analyzes when the registry has a different (older) version", async () => {
    getRegistryEntry.mockResolvedValue({ last_version: "rev0" } as never);
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });
    expect(res[0].status).toBe("analyzed");
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("analyzes a brand-new file (no registry entry)", async () => {
    getRegistryEntry.mockResolvedValue(null);
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });
    expect(res[0].status).toBe("analyzed");
  });
});

describe("analyze — recap (D)", () => {
  it("exports content, calls Flash, and returns the recap in-memory (no Drive write)", async () => {
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev9")] });

    expect(exportText).toHaveBeenCalledWith("A", "application/vnd.google-apps.document");

    const gen = generateStructured.mock.calls[0][0];
    expect(gen.model).toBe("gemini-2.5-flash");
    expect(gen.responseSchema).toBeTruthy();
    expect(typeof gen.prompt).toBe("string");
    expect(gen.prompt).toContain("document body text"); // content fed to the model

    // U12.1 — recap rides back in-memory; reconcile persists it. No recapFileId.
    expect(res[0]).toMatchObject({ fileId: "A", version: "rev9", status: "analyzed", recapFileId: null });
    expect(res[0].recap).toBeTruthy();
    // U12.4 — the file's last modifier rides back on the result for attribution.
    expect(res[0].modifiedBy).toBe("Mario Rossi");
  });

  it("never sends non-editable files to Gemini (they are filtered out)", async () => {
    const nonMod = editable("B", "rev1", { mimeType: "application/pdf", kind: "non_mod" });
    const removed = editable("C", "rev1", { changeType: "removed", kind: null });
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [nonMod, removed, editable("A", "rev1")] });

    expect(res.map((r) => r.fileId)).toEqual(["A"]); // only the editable change
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("sets is_deliverable from detect's cross-ref, not from the model output", async () => {
    generateStructured.mockResolvedValue({ ...RECAP, is_deliverable: false }); // model says false
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1", { isDeliverable: true })], // detect says true (authoritative)
    });
    expect(res[0].recap?.is_deliverable).toBe(true);
  });
});

describe("analyze — resilience", () => {
  it("turns a single file's failure into status=error and continues the batch", async () => {
    generateStructured
      .mockRejectedValueOnce(new Error("Gemini returned an empty response."))
      .mockResolvedValueOnce({ ...RECAP });

    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1"), editable("B", "rev2")],
    });

    const a = res.find((r) => r.fileId === "A")!;
    const b = res.find((r) => r.fileId === "B")!;
    expect(a.status).toBe("error");
    expect(a.error).toMatch(/empty/i);
    expect(a.recapFileId).toBeNull();
    expect(b.status).toBe("analyzed");
    // the errored file produced no recap; the healthy one did (in-memory)
    expect(a.recap).toBeNull();
    expect(b.recap).toBeTruthy();
    expect(b.recapFileId).toBeNull();
  });

  it("errors (not skips) when export fails", async () => {
    exportText.mockRejectedValue(new Error("export 403"));
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });
    expect(res[0].status).toBe("error");
    expect(res[0].error).toMatch(/403/);
  });
});
