import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const createDoc = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
}));

import {
  renderProjectOverviewHtml,
  seedProjectContext,
  PROJECT_OVERVIEW_DOC_NAME,
} from "@/lib/plan-import/context-seed";
import type { ProjectPlan } from "@/lib/plan-import/types";

const plan: ProjectPlan = {
  workspaceName: "ARISE & Co",
  parentBoardTitle: "ARISE · Plan",
  workPackages: [
    {
      code: "WP1",
      title: "Requirements <phase>",
      option: "RI",
      start: "2026-01-01",
      end: "2026-06-30",
      description: "Gather & define the system requirements.",
      lead: "INNOVINA",
      tasks: [
        { title: "T1.1", description: "d", owner: "INNOVINA" },
        { title: "T1.2", description: "d", owner: "ACME" },
      ],
      deliverables: [
        { title: "D1.1 — Reqs doc", taskIndex: 0, due: "2026-06-30", month: 6, description: "the spec" },
      ],
    },
  ],
  milestones: [{ name: "M6 — Baseline", date: "2026-06-30", description: "first review" }],
};

beforeEach(() => {
  createDoc.mockReset();
  createDoc.mockResolvedValue({ id: "ctx-doc", webViewLink: "https://docs/ctx" });
});

describe("renderProjectOverviewHtml", () => {
  it("renders the plan's name, partners, work packages, deliverables and milestones", () => {
    const html = renderProjectOverviewHtml(plan);
    expect(html).toContain("ARISE &amp; Co — Project overview");
    expect(html).toContain("<b>Partners:</b> INNOVINA, ACME"); // WP lead + task owners, distinct
    expect(html).toContain("WP1 — Requirements"); // work package heading
    expect(html).toContain("Gather &amp; define the system requirements."); // objective
    expect(html).toContain("D1.1 — Reqs doc (M6, due 2026-06-30) — the spec"); // deliverable line
    expect(html).toContain("<b>M6 — Baseline</b> — 2026-06-30 — first review"); // milestone
  });

  it("escapes HTML in plan text (no raw angle brackets leak through)", () => {
    const html = renderProjectOverviewHtml(plan);
    expect(html).toContain("Requirements &lt;phase&gt;");
    expect(html).not.toContain("Requirements <phase>");
  });

  it("omits sections that have no data", () => {
    const bare: ProjectPlan = {
      workspaceName: "Bare",
      parentBoardTitle: "Bare",
      workPackages: [],
      milestones: [],
    };
    const html = renderProjectOverviewHtml(bare);
    expect(html).toContain("Bare — Project overview");
    expect(html).not.toContain("Partners:");
    expect(html).not.toContain("<h2>Milestones</h2>");
  });
});

describe("seedProjectContext", () => {
  it("writes the overview Doc into the Context folder", async () => {
    const res = await seedProjectContext("ctx-folder", plan);
    expect(createDoc).toHaveBeenCalledTimes(1);
    const arg = createDoc.mock.calls[0][0];
    expect(arg.name).toBe(PROJECT_OVERVIEW_DOC_NAME);
    expect(arg.parentId).toBe("ctx-folder");
    expect(arg.content).toContain("ARISE &amp; Co — Project overview");
    expect(res).toEqual({ id: "ctx-doc", webViewLink: "https://docs/ctx" });
  });
});
