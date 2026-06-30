import { describe, it, expect, vi, beforeEach } from "vitest";

// U8 reconcile — step G: sync the registry projection from a run's detect +
// analyze + removed outputs, then record the run. The registry data layer is
// mocked so this verifies the state/version rules and the removed-id
// intersection with no DB.
vi.mock("server-only", () => ({}));

const upsertRegistryEntry = vi.fn();
const listRegistry = vi.fn();
const recordRun = vi.fn();

vi.mock("@/lib/pma/registry", () => ({
  upsertRegistryEntry: (...a: unknown[]) => upsertRegistryEntry(...a),
  listRegistry: (...a: unknown[]) => listRegistry(...a),
  recordRun: (...a: unknown[]) => recordRun(...a),
}));

import { reconcile } from "@/lib/pma/reconcile";
import type { AnalyzeFileResult } from "@/lib/pma/analyze";
import type { DetectedFile } from "@/lib/pma/detect";

const WS = "ws-1";
const NOW = "2026-06-08T13:00:00Z";

const editable = (id: string, version: string, over: Partial<DetectedFile> = {}): DetectedFile => ({
  fileId: id,
  name: id,
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: NOW,
  headRevisionId: null,
  version,
  lastModifiedBy: null,
  kind: "editable",
  isDeliverable: false,
  cardLinkId: null,
  changeType: "added_or_edited",
  ...over,
});

const nonMod = (id: string, version: string): DetectedFile =>
  editable(id, version, { mimeType: "application/pdf", kind: "non_mod" });

const removedFile = (id: string): DetectedFile => ({
  fileId: id,
  name: null,
  mimeType: null,
  modifiedTime: null,
  headRevisionId: null,
  version: null,
  lastModifiedBy: null,
  kind: null,
  isDeliverable: false,
  cardLinkId: null,
  changeType: "removed",
});

const outcome = (id: string, status: AnalyzeFileResult["status"], over: Partial<AnalyzeFileResult> = {}): AnalyzeFileResult => ({
  fileId: id,
  version: "v1",
  status,
  recapFileId: status === "analyzed" ? `recap-${id}` : null,
  recap: null,
  error: status === "error" ? "boom" : null,
  ...over,
});

const payloadFor = (id: string) =>
  upsertRegistryEntry.mock.calls.map((c) => c[0]).find((p) => p.sourceFileId === id);

beforeEach(() => {
  upsertRegistryEntry.mockReset();
  listRegistry.mockReset();
  recordRun.mockReset();
  upsertRegistryEntry.mockResolvedValue({});
  listRegistry.mockResolvedValue([]);
  recordRun.mockResolvedValue({ id: "run-1" });
});

describe("reconcile — registry state rules", () => {
  it("analyzed → active, advances last_version, stamps last_analyzed_at + recap json", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v9")],
      analysis: [
        outcome("A", "analyzed", {
          version: "v9",
          recap: { one_line_summary: "did stuff" } as never,
        }),
      ],
      removed: [],
      report: null,
      runStatus: "success",
      now: NOW,
    });
    expect(payloadFor("A")).toMatchObject({
      state: "active",
      lastVersion: "v9",
      lastAnalyzedAt: NOW,
      // U12.1 — recap body persisted to recap_json, not a Drive pointer.
      recapJson: { one_line_summary: "did stuff" },
    });
  });

  it("on a FAILED run, an analyzed file does NOT advance last_version (re-analyzes on retry)", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v9")],
      analysis: [
        outcome("A", "analyzed", {
          version: "v9",
          recap: { one_line_summary: "did stuff" } as never,
        }),
      ],
      removed: [],
      report: null,
      runStatus: "error",
      now: NOW,
    });
    const p = payloadFor("A");
    expect(p.state).toBe("active");
    expect("lastVersion" in p).toBe(false); // gate NOT advanced on a failed run
    expect("recapJson" in p).toBe(false);
  });

  it("error → state=error and last_version is LEFT UNTOUCHED (retries next run)", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v9")],
      analysis: [outcome("A", "error")],
      removed: [],
      report: null,
      runStatus: "success",
      now: NOW,
    });
    const p = payloadFor("A");
    expect(p.state).toBe("error");
    expect("lastVersion" in p).toBe(false); // omitted → DB value preserved
  });

  it("skipped editable → active with current version, no recap/analyzed-at churn", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v9")],
      analysis: [outcome("A", "skipped")],
      removed: [],
      report: null,
      runStatus: "success",
      now: NOW,
    });
    const p = payloadFor("A");
    expect(p).toMatchObject({ state: "active", lastVersion: "v9" });
    expect("recapJson" in p).toBe(false);
    expect("lastAnalyzedAt" in p).toBe(false);
  });

  it("non_mod (never analysed) → tracked as active metadata only", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [nonMod("P", "v3")],
      analysis: [], // non_mod files never reach analyze
      removed: [],
      report: null,
      runStatus: "success",
      now: NOW,
    });
    expect(payloadFor("P")).toMatchObject({ state: "active", kind: "non_mod", lastVersion: "v3" });
  });
});

describe("reconcile — removed intersection (source files only)", () => {
  it("marks removed only ids that exist in the registry; drops phantom ids", async () => {
    listRegistry.mockResolvedValue([
      { sourceFileId: "KNOWN" },
      { sourceFileId: "OTHER" },
    ]);

    const res = await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [],
      analysis: [],
      removed: [removedFile("KNOWN"), removedFile("PHANTOM")],
      report: null,
      runStatus: "success",
      now: NOW,
    });

    expect(payloadFor("KNOWN")).toMatchObject({ state: "removed" });
    expect(payloadFor("PHANTOM")).toBeUndefined(); // not in registry → skipped
    expect(res.removedApplied).toBe(1);
  });

  it("does not query the registry when there are no removed files", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v1")],
      analysis: [outcome("A", "analyzed", { version: "v1" })],
      removed: [],
      report: null,
      runStatus: "success",
      now: NOW,
    });
    expect(listRegistry).not.toHaveBeenCalled();
  });
});

describe("reconcile — run record", () => {
  it("records the run with status, counts, report pointers and run_at", async () => {
    recordRun.mockResolvedValue({ id: "run-9" });
    const res = await reconcile({
      workspaceId: WS,
      triggeredBy: "u1",
      detected: [editable("A", "v1"), nonMod("P", "v1")],
      analysis: [outcome("A", "analyzed", { version: "v1" })],
      removed: [],
      report: {
        reportFileId: "doc-1",
        reportWebViewLink: "https://docs/doc-1",
        counts: { changed: 1, missed: 0, removed: 0 },
      },
      runStatus: "success",
      now: NOW,
      windowStart: "2026-06-07T00:00:00.000Z",
      windowEnd: "2026-06-08T23:59:59.999Z",
      fingerprint: { A: "v1" },
    });

    expect(recordRun).toHaveBeenCalledWith({
      workspaceId: WS,
      triggeredBy: "u1",
      status: "success",
      counts: { changed: 1, missed: 0, removed: 0 },
      reportFileId: "doc-1",
      reportWebViewLink: "https://docs/doc-1",
      runAt: NOW,
      windowStart: "2026-06-07T00:00:00.000Z",
      windowEnd: "2026-06-08T23:59:59.999Z",
      fingerprint: { A: "v1" },
      settings: null,
    });
    expect(res.run).toEqual({ id: "run-9" });
    expect(res.registered).toBe(2); // analyzed A + non_mod P
  });

  it("still records a (failed) run when synthesis produced no report", async () => {
    await reconcile({
      workspaceId: WS,
      triggeredBy: null,
      detected: [],
      analysis: [],
      removed: [],
      report: null,
      runStatus: "error",
      now: NOW,
    });
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", counts: null, reportFileId: null }),
    );
  });
});
