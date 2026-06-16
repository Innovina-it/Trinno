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
});
