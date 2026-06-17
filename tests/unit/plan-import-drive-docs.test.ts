import { describe, it, expect, vi } from "vitest";

// drive-docs.ts carries `import "server-only"` and pulls the Drive client
// (googleapis). Stub both so the pure HTML builder can be imported in isolation.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: vi.fn(),
  createFolder: vi.fn(),
  createDoc: vi.fn(),
}));

import { deliverableDocHtml } from "@/lib/plan-import/drive-docs";

describe("deliverableDocHtml", () => {
  it("renders title, subtitle and a section skeleton, escaping HTML", () => {
    const html = deliverableDocHtml({
      title: "D1.1 — A & B <test>",
      subtitle: "INNOVINA · M6",
    });
    expect(html).toContain("<h1>D1.1 — A &amp; B &lt;test&gt;</h1>");
    expect(html).toContain("INNOVINA · M6");
    expect(html).toContain("Executive summary");
  });

  it("renders a metadata table and the description when provided", () => {
    const html = deliverableDocHtml({
      title: "D1",
      project: "AEGIS — Project Plan",
      workPackage: "WP1 · Requirements",
      owner: "BE-ST",
      milestone: "M6",
      due: "2026-06-30",
      description: "What this deliverable covers.",
    });
    expect(html).toContain("<table");
    expect(html).toContain("Project");
    expect(html).toContain("AEGIS — Project Plan");
    expect(html).toContain("BE-ST");
    expect(html).toContain("What this deliverable covers.");
  });

  it("omits the table when there is no metadata", () => {
    expect(deliverableDocHtml({ title: "D1" })).not.toContain("<table");
  });
});
