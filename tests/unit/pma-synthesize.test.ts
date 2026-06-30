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

import {
  synthesize,
  renderReportDoc,
  looksSuperseded,
  deliverableKey,
  groupByDeliverable,
} from "@/lib/pma/synthesize";
import type { SynthesisReport } from "@/lib/pma/synthesize";
import { ALL_SECTIONS_ON } from "@/lib/pma/report-sections";
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
  file_status: "draft",
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
  next_steps: ["finalize the spec"],
  recommendations: ["lock the baseline before prototyping"],
  risk_outlook: "Schedule risk is moderate; the spec slip could cascade.",
  budget_notes: [],
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
    // #5b — deliverables = distinct deliverables behind the analysed files (1 here).
    expect(res.counts).toEqual({ changed: 1, missed: 1, removed: 1, deliverables: 1 });
  });

  it("flags an older-generation file by name (looks_superseded) without dropping it (#4)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [{ ...analyzed("A"), name: "First Output (old).gdoc" }, analyzed("B")],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"looks_superseded": true'); // the old file is flagged
    expect(prompt).toContain('"file": "First Output (old).gdoc"'); // still present — never dropped
    const doc = createReport.mock.calls[0][1];
    expect(doc.content).toContain("(likely superseded draft)"); // visible label in the report
  });

  it("flags a clean-named file by its ancestor folder, without dropping it (#4)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      // clean filename, but sits under the superseded folder
      fileResults: [
        { ...analyzed("A"), name: "AIWEPI T2.1 Ingegneria dei Requisiti.docx", folderPath: ["First Output (old)"] },
      ],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"looks_superseded": true'); // flagged by folder, not name
    const doc = createReport.mock.calls[0][1];
    expect(doc.content).toContain("(likely superseded draft)");
  });

  it("collapses the EN/IT/pptx copies of one deliverable into a single row (#5b)", async () => {
    const res = await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [
        { ...analyzed("a"), name: "AIWEPI_T2.1_Requirements_Engineering.docx" },
        { ...analyzed("b"), name: "AIWEPI_T2.1_Ingegneria_dei_Requisiti.docx" },
        { ...analyzed("c"), name: "AIWEPI T2.1 Requirements Engineering.pptx" },
      ],
      removed: [],
      baseline: null,
      live: emptyLive,
    });
    const doc = createReport.mock.calls[0][1];
    expect(doc.content).toContain("(+2 more versions: same deliverable)"); // one collapsed row
    expect(doc.content).toContain("1 deliverable · 3 files"); // header reconciles 1 vs 3
    // counts: 3 source files, but 1 deliverable — persisted so the UI can show it
    expect(res.counts.changed).toBe(3);
    expect(res.counts.deliverables).toBe(1);
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

  // Org attribution: contributors are resolved to their ORGANIZATION before the
  // payload is built, so a mapped person's name never reaches the model.
  it("resolves a mapped contributor to their org (by name) — name absent from payload", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [{ ...analyzed("A"), contributors: [{ name: "Amir", email: null }] }],
      removed: [],
      baseline: null,
      live: emptyLive,
      contributorOrgs: [{ identityKind: "name", identityKey: "Amir", org: "Innovina" }],
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Innovina"'); // org, not the person
    expect(prompt).not.toContain("Amir"); // the person's name never reaches Gemini
  });

  it("resolves a mapped contributor by EMAIL (case-insensitive)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [
        { ...analyzed("A"), contributors: [{ name: "A. Hosseini", email: "Amir@Innovina.IT" }] },
      ],
      removed: [],
      baseline: null,
      live: emptyLive,
      contributorOrgs: [
        { identityKind: "email", identityKey: "amir@innovina.it", org: "Innovina" },
      ],
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Innovina"');
    expect(prompt).not.toContain("A. Hosseini");
  });

  it("collapses two people from the same org into one label", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [
        {
          ...analyzed("A"),
          contributors: [
            { name: "Amir", email: null },
            { name: "Sara", email: null },
          ],
        },
      ],
      removed: [],
      baseline: null,
      live: emptyLive,
      contributorOrgs: [
        { identityKind: "name", identityKey: "Amir", org: "Innovina" },
        { identityKind: "name", identityKey: "Sara", org: "Innovina" },
      ],
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Innovina"'); // collapsed, not "Innovina, Innovina"
  });

  it("falls back to the person's name verbatim when unmapped", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [
        {
          ...analyzed("A"),
          contributors: [
            { name: "Amir", email: null },
            { name: "Giulia", email: null },
          ],
        },
      ],
      removed: [],
      baseline: null,
      live: emptyLive,
      // only Amir mapped; Giulia is unmapped → her name stays
      contributorOrgs: [{ identityKind: "name", identityKey: "Amir", org: "Innovina" }],
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Innovina, Giulia"');
  });

  it("bolds the resolved org label in the rendered report", async () => {
    generateStructured.mockResolvedValue({
      ...REPORT,
      new_or_changed_files: ["A.gdoc — Innovina updated the scope"],
    });
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [{ ...analyzed("A"), contributors: [{ name: "Amir", email: null }] }],
      removed: [],
      baseline: null,
      live: emptyLive,
      contributorOrgs: [{ identityKind: "name", identityKey: "Amir", org: "Innovina" }],
    });
    const body = createReport.mock.calls[0][1].content as string;
    expect(body).toContain("<b>Innovina</b>"); // org bolded, not the person
    expect(body).not.toContain("Amir");
  });

  it("empty map → contributors resolve to their names (unchanged behaviour)", async () => {
    await synthesize({
      workspaceId: WS,
      outputFolderId: OUT,
      runLabel: LABEL,
      fileResults: [{ ...analyzed("A"), contributors: [{ name: "Amir", email: null }] }],
      removed: [],
      baseline: null,
      live: emptyLive,
      contributorOrgs: [], // no mappings
    });
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('"modified_by": "Amir"'); // name, exactly as before
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
        next_steps: [],
        recommendations: [],
        risk_outlook: "",
        budget_notes: [],
      },
      runLabel: LABEL,
    });
    expect(body).toContain("(none)");
  });

  it("renders all sections by default, byte-identical with sections absent vs all-on (U3)", () => {
    const absent = renderReportDoc({ report: REPORT, runLabel: LABEL });
    const allOn = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      sections: ALL_SECTIONS_ON,
    });
    expect(allOn).toEqual(absent); // all-on must not change a single byte
    for (const heading of [
      "EXECUTIVE SUMMARY",
      "DELIVERABLES",
      "NOTABLE CHANGES",
      "NEW OR CHANGED FILES",
      "MISSED UPDATES",
      "DEVIATIONS FROM THE APPROVED BASELINE",
      "QUALITY AND RISKS",
      "PROGRESS NOTES",
      "DIFFICULTIES",
      "NEXT STEPS",
      "RECOMMENDATIONS",
      "RISK OUTLOOK",
      "BUDGET NOTES",
    ]) {
      expect(absent).toContain(heading);
    }
  });

  it("renders the forward-looking narrated sections from the report (#2)", () => {
    const body = renderReportDoc({ report: REPORT, runLabel: LABEL });
    expect(body).toContain("finalize the spec"); // next_steps bullet
    expect(body).toContain("lock the baseline before prototyping"); // recommendations
    expect(body).toContain("Schedule risk is moderate"); // risk_outlook paragraph
  });

  it("omits the narrated sections when disabled, and shows '(none)' when the model left them empty (#2)", () => {
    const off = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      sections: {
        ...ALL_SECTIONS_ON,
        next_steps: false,
        recommendations: false,
        risk_outlook: false,
        budget_notes: false,
      },
    });
    expect(off).not.toContain("NEXT STEPS");
    expect(off).not.toContain("RECOMMENDATIONS");
    expect(off).not.toContain("RISK OUTLOOK");
    expect(off).not.toContain("BUDGET NOTES");
    expect(off).toContain("EXECUTIVE SUMMARY"); // others unaffected

    // budget_notes is [] in REPORT → its section heading shows but body is "(none)".
    const on = renderReportDoc({ report: REPORT, runLabel: LABEL });
    expect(on).toContain("BUDGET NOTES");
    expect(on).toContain("(none)");
  });

  it("surfaces per-file quality_judgment + risk_flags in the Quality and risks table (#3)", () => {
    const body = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      qualityRisks: [
        { file: "spec.gdoc", status: "approved", quality: "thorough, well-sourced", risks: ["scope creep", "no owner"] },
        { file: "plan.gdoc", status: "draft", quality: "skeletal", risks: [] },
      ],
    });
    expect(body).toContain("QUALITY AND RISKS");
    expect(body).toContain("thorough, well-sourced");
    expect(body).toContain("scope creep");
    expect(body).toContain("no owner");
    expect(body).toContain("skeletal");
    // per-file status surfaces as a mono uppercased badge in the Status column
    expect(body).toContain("APPROVED");
    expect(body).toContain("DRAFT");
    // a file with no risk flags shows the em-dash placeholder, not an empty cell
    expect(body).toContain("—");
  });

  it("renders '(none)' for Quality and risks when no files were analyzed (#3)", () => {
    const body = renderReportDoc({ report: REPORT, runLabel: LABEL, qualityRisks: [] });
    expect(body).toContain("QUALITY AND RISKS");
    // the section heading is present but its body is the empty placeholder
    expect(body).toContain("(none)");
  });

  it("omits Quality and risks entirely when the section is disabled (#3)", () => {
    const body = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      qualityRisks: [{ file: "spec.gdoc", status: "final", quality: "good", risks: ["late"] }],
      sections: { ...ALL_SECTIONS_ON, quality_risks: false },
    });
    expect(body).not.toContain("QUALITY AND RISKS");
    expect(body).not.toContain("late");
    expect(body).toContain("EXECUTIVE SUMMARY"); // others unaffected
  });

  it("omits exactly the sections disabled via the sections map (U3)", () => {
    const body = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      sections: { ...ALL_SECTIONS_ON, difficulties: false, missed_updates: false },
    });
    expect(body).not.toContain("DIFFICULTIES");
    expect(body).not.toContain("MISSED UPDATES");
    // Untouched sections still render.
    expect(body).toContain("EXECUTIVE SUMMARY");
    expect(body).toContain("PROGRESS NOTES");
    expect(body).toContain("DEVIATIONS FROM THE APPROVED BASELINE");
  });

  it("treats an empty/partial sections map as all-on (absent key → enabled) (U3)", () => {
    const empty = renderReportDoc({ report: REPORT, runLabel: LABEL, sections: {} });
    const partial = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      sections: { executive_summary: true },
    });
    const absent = renderReportDoc({ report: REPORT, runLabel: LABEL });
    expect(empty).toEqual(absent);
    expect(partial).toEqual(absent); // a lone known key still leaves the rest on
  });

  it("shows a neutral source-file count, never a 'changed'/'analysed' verb (#3)", () => {
    const counts = { changed: 3, missed: 0, removed: 1 };
    const wholeDoc = renderReportDoc({ report: REPORT, runLabel: LABEL, counts });
    const windowed = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      period: "01/05/2026 – 31/05/2026",
      counts,
    });
    // the count is SOURCE files consulted, not files we edited — framed neutrally
    // and identically whether or not a period scopes the run
    for (const body of [wholeDoc, windowed]) {
      expect(body).toContain("3 files");
      expect(body).not.toContain("files changed"); // must not read as "we modified them"
      expect(body).not.toContain("files analysed");
    }
  });

  it("prefixes the deliverable count only when copies actually collapse (#5b)", () => {
    const grouped = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      counts: { changed: 18, missed: 0, removed: 0 },
      deliverableCount: 6,
    });
    expect(grouped).toContain("6 deliverables · 18 files"); // D < N → prefix

    const noCollapse = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      counts: { changed: 6, missed: 0, removed: 0 },
      deliverableCount: 6,
    });
    expect(noCollapse).toContain("6 files");
    expect(noCollapse).not.toContain("deliverables · "); // D == N → no prefix

    const absent = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      counts: { changed: 6, missed: 0, removed: 0 },
    });
    expect(absent).not.toContain("deliverables · "); // absent → legacy label
  });

  it("substantiates an empty Deviations section when a baseline exists (#7)", () => {
    const body = renderReportDoc({
      report: REPORT, // deviations: []
      runLabel: LABEL,
      baselineName: "T2.1",
      comparedCount: 33,
    });
    expect(body).toContain(
      'Compared 33 roadmap items against the approved baseline "T2.1" — no deviations found.',
    );
  });

  it("explains an empty Deviations section when no baseline is set (#7)", () => {
    const body = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      baselineName: null, // no approved baseline
      comparedCount: null,
    });
    expect(body).toContain(
      "No approved baseline is set for this workspace, so deviations were not checked.",
    );
  });

  it("falls back to '(none)' for empty Deviations when no grounding is passed (legacy)", () => {
    const body = renderReportDoc({ report: REPORT, runLabel: LABEL });
    // baselineName undefined → byte-identical legacy behaviour
    expect(body).toContain("(none)");
    expect(body).not.toContain("no deviations found");
  });

  it("substantiates an empty Missed-updates section with the analysed count (#7)", () => {
    const body = renderReportDoc({
      report: REPORT, // missed_updates: []
      runLabel: LABEL,
      counts: { changed: 5, missed: 0, removed: 0 },
    });
    expect(body).toContain(
      "All 5 analysed files were read successfully — no missed updates.",
    );
  });

  it("says no files were analysed when the analysed count is zero (#7)", () => {
    const body = renderReportDoc({
      report: REPORT,
      runLabel: LABEL,
      counts: { changed: 0, missed: 0, removed: 0 },
    });
    expect(body).toContain("No files were analysed this run.");
  });

  it("renders Difficulties with a grounded severity badge (#8)", () => {
    const body = renderReportDoc({
      report: {
        ...REPORT,
        difficulties: [{ description: "sensor latency is tight", severity: "high" }],
      },
      runLabel: LABEL,
    });
    expect(body).toContain("DIFFICULTIES");
    expect(body).toContain("sensor latency is tight");
    expect(body).toContain("HIGH"); // severity, mono uppercased badge
  });

  it("shows '(none)' for Difficulties when there are none (#8)", () => {
    const body = renderReportDoc({ report: REPORT, runLabel: LABEL }); // difficulties: []
    expect(body).toContain("DIFFICULTIES");
    expect(body).toContain("(none)");
  });
});

describe("looksSuperseded (#4)", () => {
  it("flags names that mark an older generation, leaves current ones", () => {
    expect(looksSuperseded("First Output (old).gdoc")).toBe(true);
    expect(looksSuperseded("D2.1 OLD draft")).toBe(true);
    expect(looksSuperseded("Deliverable superseded v1")).toBe(true);
    expect(looksSuperseded("Bozza vecchia")).toBe(true);
    expect(looksSuperseded("D2.1 Final.gdoc")).toBe(false);
    expect(looksSuperseded("Gold standard.gdoc")).toBe(false); // 'old' inside 'Gold' must not match
    expect(looksSuperseded(null)).toBe(false);
  });

  it("flags a clean-named file when an ANCESTOR FOLDER is superseded (#4)", () => {
    // the real welding case: "(old)" lives in the folder, not the filename
    expect(looksSuperseded("AIWEPI T2.1 Ingegneria dei Requisiti.docx", ["First Output (old)"])).toBe(true);
    expect(looksSuperseded("clean.docx", ["First Output (old)", "Presentazioni"])).toBe(true);
    expect(looksSuperseded("clean.docx", ["Deliverables"])).toBe(false);
    expect(looksSuperseded("clean.docx", [])).toBe(false);
    expect(looksSuperseded("clean.docx", undefined)).toBe(false);
  });
});

describe("deliverableKey + groupByDeliverable (#5b)", () => {
  it("maps the EN/IT/pptx copies of one deliverable to the same key", () => {
    expect(deliverableKey("AIWEPI_T2.1_Requirements_Engineering.docx")).toBe("T2.1");
    expect(deliverableKey("AIWEPI_T2.1_Ingegneria_dei_Requisiti.docx")).toBe("T2.1");
    expect(deliverableKey("AIWEPI T2.1 Requirements Engineering.pptx")).toBe("T2.1");
    // no task code → its own key, so unrelated files never merge
    expect(deliverableKey("Existing Resources for AIWEPI.docx")).toBe(
      "Existing Resources for AIWEPI.docx",
    );
  });

  it("collapses the copies into one row and counts deliverables", () => {
    const raw = [
      { rawName: "AIWEPI_T2.1_Requirements_Engineering.docx", superseded: false, status: "draft", quality: "qEN", risks: ["rEN"] },
      { rawName: "AIWEPI_T2.1_Ingegneria_dei_Requisiti.docx", superseded: false, status: "draft", quality: "qIT", risks: [] },
      { rawName: "AIWEPI T2.1 Requirements Engineering.pptx", superseded: false, status: "draft", quality: "qPPT", risks: [] },
      { rawName: "AIWEPI_T3.2_Algorithm_Design_EN.docx", superseded: false, status: "final", quality: "q32", risks: [] },
    ];
    const { rows, deliverableCount } = groupByDeliverable(raw);
    expect(deliverableCount).toBe(2); // T2.1 + T3.2
    const t21 = rows.find((r) => r.file.includes("T2.1"))!;
    expect(t21.file).toContain("(+2 more versions: same deliverable)");
    expect(t21.file).toContain(".docx"); // representative = a non-pptx copy
    expect(t21.quality).toBe("qEN"); // and its quality, not the pptx's
  });

  it("never merges a superseded copy into the deliverable group (5a boundary)", () => {
    const raw = [
      { rawName: "AIWEPI_T2.1_Requirements_Engineering.docx", superseded: false, status: "draft", quality: "current", risks: [] },
      { rawName: "AIWEPI T2.1 Ingegneria dei Requisiti.docx", superseded: true, status: "unknown", quality: "old", risks: [] },
    ];
    const { rows, deliverableCount } = groupByDeliverable(raw);
    expect(deliverableCount).toBe(2); // current T2.1 + the superseded copy, separate
    expect(rows.some((r) => r.file.includes("(likely superseded draft)"))).toBe(true);
    expect(rows.some((r) => r.quality === "current" && !r.file.includes("superseded"))).toBe(true);
  });
});
