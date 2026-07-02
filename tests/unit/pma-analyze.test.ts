import { describe, it, expect, vi, beforeEach } from "vitest";

// U6 analyze — version gate (C) + per-editable-file Flash recap (D). The Drive
// content reader, Gemini client and registry read are all mocked so this
// verifies orchestration logic with no creds and no network. `Type` from
// @google/genai stays real (the response schema is built from it). U12.1: the
// recap is returned in-memory (reconcile persists it) — analyze writes nothing.
vi.mock("server-only", () => ({}));

const getAnalyzableContent = vi.fn();
const getAnalyzableTextBefore = vi.fn();
const generateStructured = vi.fn();
const getRegistryEntry = vi.fn();

vi.mock("@/lib/pma/content", () => ({
  getAnalyzableContent: (...a: unknown[]) => getAnalyzableContent(...a),
  getAnalyzableTextBefore: (...a: unknown[]) => getAnalyzableTextBefore(...a),
}));
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
  file_status: "draft",
};

beforeEach(() => {
  getAnalyzableContent.mockReset();
  getAnalyzableTextBefore.mockReset();
  getAnalyzableTextBefore.mockResolvedValue(null); // no old revision by default
  generateStructured.mockReset();
  getRegistryEntry.mockReset();
  getRegistryEntry.mockResolvedValue(null);
  getAnalyzableContent.mockResolvedValue({ text: "document body text" });
  generateStructured.mockResolvedValue({ ...RECAP });
});

describe("analyze — version gate (C)", () => {
  it("skips a file whose headRevisionId equals the registry's last_version", async () => {
    // The registry row arrives from supabase in snake_case at runtime.
    getRegistryEntry.mockResolvedValue({ last_version: "rev1" } as never);

    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });

    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("skipped");
    expect(getAnalyzableContent).not.toHaveBeenCalled();
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

  it("BYPASSES the gate in window mode — re-reports even an already-analyzed version (U12.9)", async () => {
    getRegistryEntry.mockResolvedValue({ last_version: "rev1" } as never); // would skip if not windowed
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1")],
      windowed: true,
    });
    expect(res[0].status).toBe("analyzed"); // NOT skipped
    expect(getRegistryEntry).not.toHaveBeenCalled(); // gate not even consulted
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("carries the window revision authors onto the result (U12.9)", async () => {
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1", { windowAuthors: ["Luca", "Paolo"] })],
      windowed: true,
    });
    expect(res[0].authors).toEqual(["Luca", "Paolo"]);
  });
});

describe("analyze — recap (D)", () => {
  it("exports content, calls Flash, and returns the recap in-memory (no Drive write)", async () => {
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev9")] });

    expect(getAnalyzableContent).toHaveBeenCalledWith("A", "application/vnd.google-apps.document");

    const gen = generateStructured.mock.calls[0][0];
    expect(gen.model).toBe("gemini-3.5-flash");
    expect(gen.thinkingBudget).toBe(0); // U6d — recaps run with thinking off
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

  it("passes the model's file_status through unchanged (not overridden by detect)", async () => {
    generateStructured.mockResolvedValue({ ...RECAP, file_status: "approved" });
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1")],
    });
    expect(res[0].recap?.file_status).toBe("approved");
  });

  it("carries the file's folderPath through to the AnalyzeFileResult (#4)", async () => {
    generateStructured.mockResolvedValue({ ...RECAP });
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1", { folderPath: ["First Output (old)"] })],
    });
    expect(res[0].folderPath).toEqual(["First Output (old)"]);
  });
});

// U5 (revision delta) — windowed runs ground "what changed" in a computed diff
// against the newest revision at-or-before the window start.
describe("analyze — revision delta (U5)", () => {
  it("appends a VERIFIED CHANGES diff block and sets deltaBaseDate when an old revision exists", async () => {
    getAnalyzableContent.mockResolvedValue({ text: "title\nbudget: 40k\nend" });
    getAnalyzableTextBefore.mockResolvedValue({
      text: "title\nbudget: 10k\nend",
      revisionDate: "2026-05-30T09:00:00Z",
    });
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1")],
      windowed: true,
      windowStart: "2026-06-01T00:00:00.000Z",
    });
    expect(getAnalyzableTextBefore).toHaveBeenCalledWith(
      "A",
      "application/vnd.google-apps.document",
      "2026-06-01T00:00:00.000Z",
    );
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("VERIFIED CHANGES SINCE 2026-05-30T09:00:00Z");
    expect(prompt).toContain("- budget: 10k"); // the real diff, not an inference
    expect(prompt).toContain("+ budget: 40k");
    expect(res[0].deltaBaseDate).toBe("2026-05-30T09:00:00Z");
  });

  it("says 'none — content is identical' when the old revision matches current", async () => {
    getAnalyzableContent.mockResolvedValue({ text: "same body" });
    getAnalyzableTextBefore.mockResolvedValue({ text: "same body", revisionDate: "2026-05-30T09:00:00Z" });
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1")],
      windowed: true,
      windowStart: "2026-06-01T00:00:00.000Z",
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("none — content is identical");
    expect(res[0].deltaBaseDate).toBe("2026-05-30T09:00:00Z");
  });

  it("falls back silently when no old revision is available (best-effort)", async () => {
    getAnalyzableTextBefore.mockResolvedValue(null);
    const res = await analyze({
      workspaceId: WS,
      outputFolderId: OUT,
      files: [editable("A", "rev1")],
      windowed: true,
      windowStart: "2026-06-01T00:00:00.000Z",
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("VERIFIED CHANGES");
    expect(res[0].deltaBaseDate).toBeNull();
    expect(res[0].status).toBe("analyzed"); // never fails the file
  });

  it("does not fetch revisions at all without a windowStart (unchanged behaviour)", async () => {
    await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });
    expect(getAnalyzableTextBefore).not.toHaveBeenCalled();
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
    getAnalyzableContent.mockRejectedValue(new Error("export 403"));
    const res = await analyze({ workspaceId: WS, outputFolderId: OUT, files: [editable("A", "rev1")] });
    expect(res[0].status).toBe("error");
    expect(res[0].error).toMatch(/403/);
  });
});
