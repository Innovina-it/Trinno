import { describe, it, expect, vi, beforeEach } from "vitest";

// extract.ts carries `import "server-only"`; stub it for the node test env.
vi.mock("server-only", () => ({}));

// vi.mock is hoisted above module scope, so the mock fn must be hoisted too.
const { generateStructured } = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("@/lib/pma/clients/gemini", () => ({ generateStructured }));

import { extractPlanFromFile } from "@/lib/plan-import/extract";

const fixture = {
  workspaceName: "X — Project Plan",
  parentBoardTitle: "X · Project Plan",
  workPackages: [
    {
      code: "WP1",
      title: "WP1",
      option: "RI",
      start: "2026-01-01",
      end: "2026-06-30",
      description: "d",
      tasks: [{ title: "T1.1", description: "d" }],
      deliverables: [{ title: "D1.1", taskIndex: 0, due: "2026-06-30", month: 6, description: "d" }],
    },
  ],
  milestones: [{ name: "M6", date: "2026-06-30", description: "d" }],
};

beforeEach(() => generateStructured.mockReset());

describe("extractPlanFromFile", () => {
  it("sends the file as a base64 part with the given mimeType and returns the parsed plan", async () => {
    generateStructured.mockResolvedValue(fixture);
    const plan = await extractPlanFromFile(Buffer.from("PDFBYTES"), "application/pdf");
    expect(plan.workspaceName).toBe("X — Project Plan");
    const arg = generateStructured.mock.calls[0][0];
    expect(arg.model).toBe("gemini-3.5-flash");
    expect(arg.files[0]).toEqual({
      mimeType: "application/pdf",
      data: Buffer.from("PDFBYTES").toString("base64"),
    });
  });

  it("passes a non-PDF mimeType through (e.g. an image)", async () => {
    generateStructured.mockResolvedValue(fixture);
    await extractPlanFromFile(Buffer.from("PNGBYTES"), "image/png");
    expect(generateStructured.mock.calls[0][0].files[0].mimeType).toBe("image/png");
  });

  it("throws when the model returns a structurally invalid plan", async () => {
    generateStructured.mockResolvedValue({ workspaceName: "" });
    await expect(extractPlanFromFile(Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
