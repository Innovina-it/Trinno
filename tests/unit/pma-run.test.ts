import { describe, it, expect, vi, beforeEach } from "vitest";

// U9 runAnalysis — the A→G orchestration. inputs + the Drive/Gemini pipeline
// units are mocked so this verifies wiring, the precondition gate, the
// terminal-synthesis behaviour, and window scoping (U12.2) with no network/DB.
vi.mock("server-only", () => ({}));

const getRunInputs = vi.fn();
const detect = vi.fn();
const analyze = vi.fn();
const synthesize = vi.fn();
const reconcile = vi.fn();
const findRunByWindow = vi.fn();
const getProjectContext = vi.fn();

// The per-workspace run lock reserves a real DB connection; in this unit test it
// passes straight through to the run body (no DB).
vi.mock("@/lib/db/client", () => ({
  withWorkspaceRunLock: (_workspaceId: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/pma/inputs", () => ({ getRunInputs: (...a: unknown[]) => getRunInputs(...a) }));
vi.mock("@/lib/pma/detect", () => ({ detect: (...a: unknown[]) => detect(...a) }));
vi.mock("@/lib/pma/analyze", () => ({ analyze: (...a: unknown[]) => analyze(...a) }));
vi.mock("@/lib/pma/synthesize", () => ({ synthesize: (...a: unknown[]) => synthesize(...a) }));
vi.mock("@/lib/pma/reconcile", () => ({ reconcile: (...a: unknown[]) => reconcile(...a) }));
vi.mock("@/lib/pma/registry", () => ({
  findRunByWindow: (...a: unknown[]) => findRunByWindow(...a),
}));
vi.mock("@/lib/pma/context", () => ({
  getProjectContext: (...a: unknown[]) => getProjectContext(...a),
}));

import { runAnalysis } from "@/lib/pma/run";
import type { DetectedFile } from "@/lib/pma/detect";

const WS = "ws-1";
const NOW = "2026-06-08T13:00:00Z";
const LABEL = "08/06/2026 14:00:00 (UTC+1)";
const WINDOW = { start: "2026-06-01T00:00:00.000Z", end: "2026-06-08T23:59:59.999Z" };

const addedFile = (id: string): DetectedFile => ({
  fileId: id,
  name: id,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: NOW,
  headRevisionId: null,
  version: "v1",
  lastModifiedBy: null,
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
  runAnalysis({ token: "tok", workspaceId: WS, actorId: "user-1", now: NOW, runLabel: LABEL, window: WINDOW, ...over });

beforeEach(() => {
  getRunInputs.mockReset();
  detect.mockReset();
  analyze.mockReset();
  synthesize.mockReset();
  reconcile.mockReset();
  findRunByWindow.mockReset();
  findRunByWindow.mockResolvedValue(null); // no prior run for the window by default
  getProjectContext.mockReset();
  getProjectContext.mockResolvedValue("PROJECT BACKGROUND"); // Context folder text

  getRunInputs.mockResolvedValue({ ...okInputs });
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
  it("detects in-window, analyzes added, synthesizes (with the window), reconciles", async () => {
    const res = await run();

    expect(detect).toHaveBeenCalledWith({
      sourceFolderId: "src-folder",
      pageToken: null,
      deliverableLinks: okInputs.deliverableLinks,
      window: WINDOW,
    });

    // analyze gets only the added/edited files, in windowed mode (gate bypassed).
    expect(analyze).toHaveBeenCalledWith({
      workspaceId: WS,
      outputFolderId: "out-folder",
      files: [expect.objectContaining({ fileId: "A", changeType: "added_or_edited" })],
      windowed: true,
    });

    // synthesize gets the analysis results + removed files + baseline/live + the
    // project context read from the Source folder's Context child.
    expect(getProjectContext).toHaveBeenCalledWith("src-folder");
    const synthArg = synthesize.mock.calls[0][0];
    expect(synthArg.removed).toEqual([expect.objectContaining({ fileId: "R", changeType: "removed" })]);
    expect(synthArg.runLabel).toBe(LABEL);
    expect(synthArg.window).toEqual(WINDOW);
    expect(synthArg.baseline).toBeNull();
    expect(synthArg.context).toBe("PROJECT BACKGROUND");

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

describe("runAnalysis — no changes (U12.5)", () => {
  it("skips synthesize and records a no_changes run when nothing changed in-window", async () => {
    // detect finds a file, but the version gate skips it (unchanged) → nothing
    // reportable: no analyzed, no error, no removed.
    detect.mockResolvedValue({
      files: [addedFile("A")],
      newPageToken: null,
      bootstrapped: false,
    });
    analyze.mockResolvedValue([
      { fileId: "A", version: "v1", status: "skipped", recapFileId: null, recap: null, error: null },
    ]);

    const res = await run();

    expect(synthesize).not.toHaveBeenCalled();
    const recArg = reconcile.mock.calls[0][0];
    expect(recArg.runStatus).toBe("no_changes");
    expect(recArg.report).toBeNull();
    expect(res.status).toBe("no_changes");
    expect(res.reportWebViewLink).toBeNull();
    expect(res.counts).toBeNull();
  });

  it("records an empty_period run + the available range when nothing matched the window (U12.7/U12.10)", async () => {
    // detect finds nothing in the window, but reports the corpus range.
    detect.mockResolvedValue({
      files: [],
      newPageToken: null,
      bootstrapped: false,
      corpusRange: { first: "2026-01-01T00:00:00Z", last: "2026-06-01T00:00:00Z" },
    });
    analyze.mockResolvedValue([]);

    const res = await run();

    expect(synthesize).not.toHaveBeenCalled();
    expect(reconcile.mock.calls[0][0].runStatus).toBe("empty_period");
    expect(res.status).toBe("empty_period");
    expect(res.reportWebViewLink).toBeNull();
    // U12.10 — the documents' available range rides back so the UI can guide.
    expect(res.availableRange).toEqual({
      first: "2026-01-01T00:00:00Z",
      last: "2026-06-01T00:00:00Z",
    });
  });

  it("analyzes the whole document (allFiles, no window) when no date is given (U12.10)", async () => {
    await run({ window: undefined });
    expect(detect).toHaveBeenCalledWith({
      sourceFolderId: "src-folder",
      pageToken: null,
      deliverableLinks: okInputs.deliverableLinks,
      allFiles: true,
    });
  });
});

describe("runAnalysis — same-range dedup (U12.12)", () => {
  it("does NOT regenerate when a prior report for the same window has the same fingerprint", async () => {
    // Prior success run for this window with identical fingerprint {A: v1}.
    findRunByWindow.mockResolvedValue({
      id: "prior-run",
      status: "success",
      reportFileId: "doc-prior",
      reportWebViewLink: "https://docs/prior",
      counts: { changed: 1, missed: 0, removed: 0 },
      fingerprint: { A: "v1" }, // addedFile("A").version is "v1"
    });

    const res = await run();

    expect(synthesize).not.toHaveBeenCalled(); // no Gemini, no new Doc
    expect(reconcile).not.toHaveBeenCalled(); // no new run recorded
    expect(res.status).toBe("already_reported");
    expect(res.runId).toBe("prior-run");
    expect(res.reportWebViewLink).toBe("https://docs/prior");
  });

  it("regenerates and reports which files changed when the fingerprint differs", async () => {
    findRunByWindow.mockResolvedValue({
      id: "prior-run",
      status: "success",
      reportFileId: "doc-prior",
      reportWebViewLink: "https://docs/prior",
      counts: { changed: 1, missed: 0, removed: 0 },
      fingerprint: { A: "v0" }, // A is now v1 → changed
    });

    const res = await run();

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0][0].changedSince).toEqual(["A"]);
    expect(res.status).toBe("success");
    expect(res.changedSince).toEqual(["A"]);
  });
});

describe("runAnalysis — synthesis is terminal", () => {
  it("on synthesize failure: status=error, reconcile gets report=null, run still recorded", async () => {
    synthesize.mockRejectedValue(new Error("Gemini returned an empty response."));

    const res = await run();

    const recArg = reconcile.mock.calls[0][0];
    expect(recArg.runStatus).toBe("error");
    expect(recArg.report).toBeNull();

    expect(res.status).toBe("error");
    expect(res.runId).toBe("run-1"); // a (failed) run is still recorded
    expect(res.reportWebViewLink).toBeNull();
  });
});
