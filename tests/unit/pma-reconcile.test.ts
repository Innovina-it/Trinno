import { describe, it, expect, vi, beforeEach } from "vitest";

// U8 reconcile — step G: sync the registry projection from a run's detect +
// analyze + removed outputs. As of 0145 (run manager) reconcile NO LONGER
// records the run row — the orchestrator (run.ts) owns the run's lifecycle — so
// this verifies only the state/version rules and the removed-id intersection.
// The registry data layer is mocked so there is no DB.
vi.mock("server-only", () => ({}));

const upsertRegistryEntry = vi.fn();
const listRegistry = vi.fn();

vi.mock("@/lib/pma/registry", () => ({
  upsertRegistryEntry: (...a: unknown[]) => upsertRegistryEntry(...a),
  listRegistry: (...a: unknown[]) => listRegistry(...a),
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
  upsertRegistryEntry.mockResolvedValue({});
  listRegistry.mockResolvedValue([]);
});

describe("reconcile — registry state rules", () => {
  it("analyzed → active, advances last_version, stamps last_analyzed_at + recap json", async () => {
    await reconcile({
      workspaceId: WS,
      detected: [editable("A", "v9")],
      analysis: [
        outcome("A", "analyzed", {
          version: "v9",
          recap: { one_line_summary: "did stuff" } as never,
        }),
      ],
      removed: [],
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
      detected: [editable("A", "v9")],
      analysis: [
        outcome("A", "analyzed", {
          version: "v9",
          recap: { one_line_summary: "did stuff" } as never,
        }),
      ],
      removed: [],
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
      detected: [editable("A", "v9")],
      analysis: [outcome("A", "error")],
      removed: [],
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
      detected: [editable("A", "v9")],
      analysis: [outcome("A", "skipped")],
      removed: [],
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
      detected: [nonMod("P", "v3")],
      analysis: [], // non_mod files never reach analyze
      removed: [],
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
      detected: [],
      analysis: [],
      removed: [removedFile("KNOWN"), removedFile("PHANTOM")],
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
      detected: [editable("A", "v1")],
      analysis: [outcome("A", "analyzed", { version: "v1" })],
      removed: [],
      runStatus: "success",
      now: NOW,
    });
    expect(listRegistry).not.toHaveBeenCalled();
  });
});

describe("reconcile — result counts", () => {
  it("counts active rows upserted (analyzed + non_mod) and returns no run row", async () => {
    const res = await reconcile({
      workspaceId: WS,
      detected: [editable("A", "v1"), nonMod("P", "v1")],
      analysis: [outcome("A", "analyzed", { version: "v1" })],
      removed: [],
      runStatus: "success",
      now: NOW,
    });
    expect(res).toEqual({ registered: 2, errored: 0, removedApplied: 0 });
    expect("run" in res).toBe(false); // 0145 — reconcile no longer records the run
  });
});
