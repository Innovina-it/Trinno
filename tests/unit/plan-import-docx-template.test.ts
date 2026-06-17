import { describe, it, expect, vi } from "vitest";

// docx-template.ts carries `import "server-only"`. Stub it so the patcher (pure
// apart from reading the bundled arise.docx via fs) can be imported in vitest.
vi.mock("server-only", () => ({}));

import { unzipSync, strFromU8 } from "fflate";
import {
  buildDeliverableDocx,
  projectTitleFromWorkspaceName,
} from "@/lib/plan-import/docx-template";

describe("projectTitleFromWorkspaceName", () => {
  it("strips a trailing '— Project Plan' suffix, keeps everything else", () => {
    expect(projectTitleFromWorkspaceName("AEGIS — Project Plan")).toBe("AEGIS");
    expect(projectTitleFromWorkspaceName("AEGIS - Project Plan")).toBe("AEGIS");
    expect(projectTitleFromWorkspaceName("M.A.R.S. Wildfire")).toBe(
      "M.A.R.S. Wildfire",
    );
  });
});

describe("buildDeliverableDocx", () => {
  it("swaps the ARISE identity, fills the placeholders, stays a valid .docx", async () => {
    const docx = await buildDeliverableDocx({
      projectTitle: "AEGIS",
      partners: "INNOVINA, AITRUST",
      deliverableTitle: "D5.2 — Closure & KPI",
      subtitle: "WP5 · M18",
    });
    const entries = unzipSync(docx);
    // Still a valid OOXML package (Drive needs this to convert it).
    expect(entries["[Content_Types].xml"]).toBeTruthy();

    const doc = strFromU8(entries["word/document.xml"]);
    expect(doc).toContain("AEGIS"); // project H1 / page header / Project cell
    expect(doc).not.toContain("ARISE"); // identity fully swapped
    expect(doc).not.toContain("DINOGMI, University of Genoa"); // old partners gone
    expect(doc).toContain("AITRUST"); // new partners line
    expect(doc).toContain("WP5 · M18"); // [Document subtitle] filled
    expect(doc).toContain("Closure &amp; KPI"); // title filled, & XML-escaped
    expect(doc).not.toContain("[DOCUMENT TITLE]");
    expect(doc).not.toContain("[Document subtitle]");
  });
});
