import { describe, it, expect, vi, beforeEach } from "vitest";

// U9 runAnalysis — the A→G orchestration. inputs + the Drive/Gemini pipeline
// units are mocked so this verifies wiring, the precondition gate, the
// terminal-synthesis behaviour, and the checkpoint-advance policy with no
// network/DB.
vi.mock("server-only", () => ({}));

const getRunInputs = vi.fn();
const detect = vi.fn();
const analyze = vi.fn();
const synthesize = vi.fn();
const reconcile = vi.fn();
const getWorkspacePageToken = vi.fn();
const setWorkspacePageToken = vi.fn();

vi.mock("@/lib/pma/inputs", () => ({ getRunInputs: (...a: unknown[]) => getRunInputs(...a) }));
vi.mock("@/lib/pma/detect", () => ({ detect: (...a: unknown[]) => detect(...a) }));
vi.mock("@/lib/pma/analyze", () => ({ analyze: (...a: unknown[]) => analyze(...a) }));
vi.mock("@/lib/pma/synthesize", () => ({ synthesize: (...a: unknown[]) => synthesize(...a) }));
vi.mock("@/lib/pma/reconcile", () => ({ reconcile: (...a: unknown[]) => reconcile(...a) }));
vi.mock("@/lib/pma/registry", () => ({
  getWorkspacePageToken: (...a: unknown[]) => getWorkspacePageToken(...a),
  setWorkspacePageToken: (...a: unknown[]) => setWorkspacePageToken(...a),
}));

import { runAnalysis } from "@/lib/pma/run";
import type { DetectedFile } from "@/lib/pma/detect";

const WS = "ws-1";
const NOW = "2026-06-08T13:00:00Z";
const LABEL = "08/06/2026 14:00:00 (UTC+1)";

const addedFile = (id: string): DetectedFile => ({
  fileId: id,
  name: id,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: NOW,
  headRevisionId: null,
  version: "v1",
  kind: "editable",
  isDeliverable: false,
  cardLinkId: null,
  changeType: "added_or_edited",
});

const removedFile = (id: string): DetectedFile => ({
  ...addedFile(id),
  mimeType: null,
  version: null,
  kind: null,
  changeType: "removed",
});

const okInputs = {
  sourceFolderId: "src-folder",
  outputFolderId: "out-folder",
  deliverableLinks: [{ id: "l1", url: "https://drive.google.com/file/d/abc/view" }],
  live: { entries: [], milestones: [] },
  baseline: null,
};

const run = (over: Record<string, unknown> = {}) =>
  runAnalysis({ token: "tok", workspaceId: WS, actorId: "user-1", now: NOW, runLabel: LABEL, ...over });

beforeEach(() => {
  getRunInputs.mockReset();
  detect.mockReset();
  analyze.mockReset();
  synthesize.mockReset();
  reconcile.mockReset();
  getWorkspacePageToken.mockReset();
  setWorkspacePageToken.mockReset();

  getRunInputs.mockResolvedValue({ ...okInputs });
  getWorkspacePageToken.mockResolvedValue("tok-prev");
  detect.mockResolvedValue({
    files: [addedFile("A"), removedFile("R")],
    newPageToken: "tok-next",
    bootstrapped: false,
  });
  analyze.mockResolvedValue([
    { fileId: "A", version: "v1", status: "analyzed", recapFileId: "recap-A", recap: {}, error: null },
  ]);
  synthesize.mockResolvedValue({
    report: {},
    reportFileId: "doc-1",
    reportWebViewLink: "https://docs/doc-1",
    counts: { changed: 1, missed: 0, removed: 1 },
  });
  reconcile.mockResolvedValue({ registered: 1, errored: 0, removedApplied: 1, run: { id: "run-1" } });
});

describe("runAnalysis — precondition", () => {
  it("throws FAILED_PRECONDITION and never detects when a folder is unconfigured", async () => {
    getRunInputs.mockResolvedValue({ ...okInputs, outputFolderId: null });
    await expect(run()).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    expect(detect).not.toHaveBeenCalled();
  });
});

describe("runAnalysis — happy path wiring", () => {
  it("loads the checkpoint, detects, analyzes added, synthesizes, reconciles, advances the token", async () => {
    const res = await run();

    expect(getWorkspacePageToken).toHaveBeenCalledWith(WS);
    expect(detect).toHaveBeenCalledWith({
      sourceFolderId: "src-folder",
      pageToken: "tok-prev",
      deliverableLinks: okInputs.deliverableLinks,
    });

    // analyze gets only the added/edited files.
    expect(analyze).toHaveBeenCalledWith({
      workspaceId: WS,
      outputFolderId: "out-folder",
      files: [expect.objectContaining({ fileId: "A", changeType: "added_or_edited" })],
    });

    // synthesize gets the analysis results + removed files + baseline/live.
    const synthArg = synthesize.mock.calls[0][0];
    expect(synthArg.removed).toEqual([expect.objectContaining({ fileId: "R", changeType: "removed" })]);
    expect(synthArg.runLabel).toBe(LABEL);
    expect(synthArg.baseline).toBeNull();

    // reconcile records the run with the report pointer + success status.
    const recArg = reconcile.mock.calls[0][0];
    expect(recArg).toMatchObject({
      workspaceId: WS,
      triggeredBy: "user-1",
      runStatus: "success",
      now: NOW,
      report: { reportFileId: "doc-1", reportWebViewLink: "https://docs/doc-1", counts: { changed: 1, missed: 0, removed: 1 } },
    });
    expect(recArg.detected).toEqual([expect.objectContaining({ fileId: "A" })]);

    // token advanced on success.
    expect(setWorkspacePageToken).toHaveBeenCalledWith(WS, "tok-next");

    expect(res).toMatchObject({
      runId: "run-1",
      status: "success",
      reportWebViewLink: "https://docs/doc-1",
      counts: { changed: 1, missed: 0, removed: 1 },
      bootstrapped: false,
    });
  });
});

describe("runAnalysis — tripwire: write-only-to-Output (DESIGN §52)", () => {
  it("routes the SOURCE folder only to detect (read); writers only ever get the OUTPUT folder", async () => {
    await run();

    // detect READS the source folder.
    expect(detect.mock.calls[0][0].sourceFolderId).toBe("src-folder");

    // every write-side unit is handed the OUTPUT folder, never the source.
    const analyzeFolder = analyze.mock.calls[0][0].outputFolderId;
    const synthFolder = synthesize.mock.calls[0][0].outputFolderId;
    expect(analyzeFolder).toBe("out-folder");
    expect(synthFolder).toBe("out-folder");
    expect([analyzeFolder, synthFolder]).not.toContain("src-folder");
  });
});

describe("runAnalysis — synthesis is terminal", () => {
  it("on synthesize failure: status=error, reconcile gets report=null, token NOT advanced, run still recorded", async () => {
    synthesize.mockRejectedValue(new Error("Gemini returned an empty response."));

    const res = await run();

    const recArg = reconcile.mock.calls[0][0];
    expect(recArg.runStatus).toBe("error");
    expect(recArg.report).toBeNull();

    expect(setWorkspacePageToken).not.toHaveBeenCalled(); // failed run re-detects next time
    expect(res.status).toBe("error");
    expect(res.runId).toBe("run-1"); // a (failed) run is still recorded
    expect(res.reportWebViewLink).toBeNull();
  });
});
