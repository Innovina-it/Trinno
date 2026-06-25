import { describe, it, expect, vi, beforeEach } from "vitest";

// U7 synthesize — aggregate recaps + missed/removed + GROUNDED baseline-vs-live
// variance → Gemini Pro report → Google Doc in the Output folder. The Gemini
// client and the Output writer are mocked; the baseline comparator
// (compareToBaseline) stays REAL so we prove the deviation is grounded in code,
// not invented by the model. `Type` from @google/genai stays real.
vi.mock("server-only", () => ({}));

const generateStructured = vi.fn();
const createReport = vi.fn();

vi.mock("@/lib/pma/clients/gemini", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
}));
vi.mock("@/lib/pma/output", () => ({
  createReport: (...a: unknown[]) => createReport(...a),
}));

import { synthesize, renderReportDoc } from "@/lib/pma/synthesize";
import type { SynthesisReport } from "@/lib/pma/synthesize";
import type { AnalyzeFileResult, FileRecap } from "@/lib/pma/analyze";
import type { DetectedFile } from "@/lib/pma/detect";
import type { BaselineDetail } from "@/lib/baselines/types";

const WS = "ws-1";
const OUT = "out-folder";
const LABEL = "2026-06-08 14:32 (UTC+1)";

const recap = (over: Partial<FileRecap> = {}): FileRecap => ({
  additions: ["a"],
  edits: ["e"],
  structural_changes: [],
  one_line_summary: "tightened the scope section",
  recap: ["line"],
  quality_judgment: "good",
  importance: "medium",
  risk_flags: [],
  is_deliverable: false,
  ...over,
});

const analyzed = (id: string, over: Partial<FileRecap> = {}): AnalyzeFileResult => ({
  fileId: id,
  version: "v1",
  status: "analyzed",
  recapFileId: `recap-${id}`,
  recap: recap(over),
  error: null,
  modifiedBy: "Mario Rossi",
  name: `${id}.gdoc`,
});

const errored = (id: string): AnalyzeFileResult => ({
  fileId: id,
  version: "v1",
  status: "error",
  recapFileId: null,
  recap: null,
  error: "Gemini returned an empty response.",
});

const skipped = (id: string): AnalyzeFileResult => ({
  fileId: id,
  version: "v1",
  status: "skipped",
  recapFileId: null,
  recap: null,
  error: null,
});

const removedFile = (id: string, over: Partial<DetectedFile> = {}): DetectedFile => ({
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
  ...over,
});

const REPORT: SynthesisReport = {
  executive_summary: "Steady progress; one deliverable slipped.",
  deliverables_focus: "The spec deliverable was revised.",
  notable_changes: ["scope tightened"],
  new_or_changed_files: ["spec.gdoc"],
  missed_updates: [],
  deviations: [],
  progress_notes: ["on track overall"],
  difficulties: [],
};

const emptyLive = { entries: [], milestones: [] };

beforeEach(() => {
  generateStructured.mockReset();
  createReport.mockReset();
  generateStructured.mockResolvedValue({ ...REPORT });
  createReport.mockResolvedValue({ id: "doc-1", webViewLink: "https://docs/doc-1" });
});

describe("synthesize — aggregate + report", () => {
  it("calls Gemini Pro, writes the report Doc to the Output folder, returns the pointer + counts", async () => {
    const res = await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A"), errored("B"), skipped("C")],
      removed: [removedFile("D")],
      baseline: null,
      live: emptyLive,
    });

    // Synthesis runs on Flash (gemini-3.5-flash), unified with the recap tier.
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured.mock.calls[0][0].model).toBe("gemini-3.5-flash");

    // Wrote a Google Doc into the OUTPUT folder, name carries the run label.
    expect(createReport).toHaveBeenCalledTimes(1);
    const [folder, doc] = createReport.mock.calls[0];
    expect(folder).toBe(OUT);
    expect(doc.name).toContain(LABEL);
    expect(doc.content).toContain("Steady progress"); // rendered from the report

    expect(res.reportFileId).toBe("doc-1");
    expect(res.reportWebViewLink).toBe("https://docs/doc-1");
    // changed = analyzed only; skipped does NOT count as changed.
    expect(res.counts).toEqual({ changed: 1, missed: 1, removed: 1 });
  });

  it("injects the PROJECT CONTEXT block into the prompt when context is given", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A")],
      removed: [],
      baseline: null,
      live: emptyLive,
      context: "Project goal: ship the grant deliverables by Q3.",
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("--- PROJECT CONTEXT START ---");
    expect(prompt).toContain("Project goal: ship the grant deliverables by Q3.");
    expect(prompt).toContain("--- PROJECT CONTEXT END ---");
  });

  it("omits the PROJECT CONTEXT block when no context is given", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A")],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("PROJECT CONTEXT");
  });

  it("credits all window revision authors in modified_by (U12.9)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [{ ...analyzed("A"), authors: ["Luca", "Paolo"] }],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Luca, Paolo"'); // window authors, joined
  });

  it("references the file by name, not the raw Drive fileId (U12.8)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A")], // helper sets name "A.gdoc"
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"file": "A.gdoc"'); // the name, not a bare id
  });

  it("includes each changed file's modified_by (or 'non noto') in the payload", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      // A has a modifier (helper sets Mario Rossi); B's is cleared → "non noto".
      fileResults: [analyzed("A"), { ...analyzed("B"), modifiedBy: null }],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by"');
    expect(prompt).toContain("Mario Rossi"); // attributed author
    expect(prompt).toContain("unknown"); // unknown author fallback
  });

  it("feeds analyzed recaps (not skipped ones) to the model", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A"), skipped("C")],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("tightened the scope section"); // A's summary
    expect(prompt).not.toContain('"file": "C"'); // skipped file not in payload
  });
});

describe("synthesize — grounded deviation (reuses compareToBaseline)", () => {
  it("computes the baseline-vs-live variance in code and feeds the deltas to Gemini", async () => {
    const baseline: BaselineDetail = {
      meta: {
        id: "b1",
        workspaceId: WS,
        name: "Q2 Approved",
        note: null,
        createdBy: "u1",
        createdAt: "2026-04-01T00:00:00Z",
        isApproved: true,
      },
      entries: [
        {
          cardId: "card-1",
          title: "Ship onboarding",
          startDate: "2026-05-01T00:00:00Z",
          targetDate: "2026-06-01T00:00:00Z",
          completedAt: null,
          roadmapOrder: 1,
          sprintId: null,
          parentCardId: null,
          assignees: [],
        },
      ],
      milestones: [],
    };
    // Live target is 10 days later than baseline → a grounded "slipped".
    const live = {
      entries: [
        {
          cardId: "card-1",
          title: "Ship onboarding",
          startDate: "2026-05-01T00:00:00Z",
          targetDate: "2026-06-11T00:00:00Z",
          completedAt: null,
          roadmapOrder: 1,
          sprintId: null,
          parentCardId: null,
          assignees: [],
        },
      ],
      milestones: [],
    };

    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [],
      removed: [],
      baseline,
      live,
    });

    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("An Approved baseline exists");
    expect(prompt).toContain("Ship onboarding"); // the changed card
    expect(prompt).toContain("slipped"); // status computed by compareToBaseline
    expect(prompt).toContain("10"); // targetDeltaDays grounded in code
  });

  it("omits variance and tells the model there is no baseline when none is approved", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [analyzed("A")],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("No Approved roadmap baseline");
    expect(prompt).toContain('"roadmap_variance": null');
  });
});

describe("synthesize — failure is terminal for the run", () => {
  it("propagates a Gemini failure (no Doc written)", async () => {
    generateStructured.mockRejectedValue(new Error("Gemini returned an empty response."));
    await expect(
      synthesize({
        workspaceId: WS,
        outputFolderId: OUT,
        runLabel: LABEL,
        fileResults: [analyzed("A")],
        removed: [],
        baseline: null,
        live: emptyLive,
      }),
    ).rejects.toThrow(/empty/i);
    expect(createReport).not.toHaveBeenCalled();
  });
});

describe("renderReportDoc", () => {
  it("renders the branded masthead, sections, and a deviations table", () => {
    const body = renderReportDoc({
      report: {
        ...REPORT,
        deliverables_focus: "Spec deliverable revised twice.",
        deviations: [
          {
            item: "Ship onboarding",
            baseline_value: "2026-06-01",
            current_value: "2026-06-11",
            type: "delay",
            severity: "medium",
          },
        ],
      },
      runLabel: LABEL,
      workspaceName: "SWICH",
      counts: { changed: 2, missed: 1, removed: 0 },
    });
    expect(body).toContain("SWICH · Analysis"); // masthead title (workspace name)
    expect(body).toContain(LABEL); // run label in the meta table
    expect(body).toContain("EXECUTIVE SUMMARY"); // section label (uppercased literal)
    expect(body).toContain("DELIVERABLES");
    expect(body).toContain("Spec deliverable revised twice.");
    // deviation rendered as a monochrome table row, type/severity uppercased
    expect(body).toContain("Ship onboarding");
    expect(body).toContain("DELAY");
    expect(body).toContain("MEDIUM");
    expect(body).toContain("2026-06-01 → 2026-06-11");
  });

  it("falls back to a plain 'Analysis' title when no workspace name is given", () => {
    const body = renderReportDoc({ report: REPORT, runLabel: LABEL });
    expect(body).toContain(">Analysis<"); // masthead title div text
  });

  it("bolds known author names in the HTML body (U12.6)", () => {
    const body = renderReportDoc({
      report: { ...REPORT, new_or_changed_files: ["spec.gdoc — Mario Rossi", "plan.gdoc — unknown"] },
      runLabel: LABEL,
      authors: ["Mario Rossi"],
    });
    expect(body).toContain("<b>Mario Rossi</b>");
    expect(body).toContain("unknown"); // unknown author left unbolded
    expect(body).not.toContain("<b>unknown</b>");
  });

  it("renders a deterministic 'history unavailable' notice when revisionErrorCount > 0, and nothing when 0/absent", () => {
    const withErr = renderReportDoc({ report: REPORT, runLabel: LABEL, revisionErrorCount: 2 });
    expect(withErr).toContain("HISTORY UNAVAILABLE"); // uppercased section label
    expect(withErr).toContain("for 2 files"); // the count, surfaced to the reader

    // Byte-level guard: absent or 0 → no notice (report unchanged vs before the field).
    const absent = renderReportDoc({ report: REPORT, runLabel: LABEL });
    const zero = renderReportDoc({ report: REPORT, runLabel: LABEL, revisionErrorCount: 0 });
    expect(absent).not.toContain("HISTORY UNAVAILABLE");
    expect(zero).not.toContain("HISTORY UNAVAILABLE");
    expect(zero).toEqual(absent); // 0 renders identically to absent
  });

  it("shows (none) for empty sections", () => {
    const body = renderReportDoc({
      report: {
        executive_summary: "",
        deliverables_focus: "",
        notable_changes: [],
        new_or_changed_files: [],
        missed_updates: [],
        deviations: [],
        progress_notes: [],
        difficulties: [],
      },
      runLabel: LABEL,
    });
    expect(body).toContain("(none)");
  });
});
