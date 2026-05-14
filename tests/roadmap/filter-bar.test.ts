import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RoadmapFilterBar", () => {
  it("renders the Mine hidden-card badge from the supplied count", () => {
    const src = readFileSync(
      "components/roadmap/roadmap-filter-bar.tsx",
      "utf8",
    );

    expect(src).toContain("mineHiddenCount");
    expect(src).toContain("roadmap-mine-hidden-badge");
    expect(src).toContain("more not shown");
  });
});
