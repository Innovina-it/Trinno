import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roadmapView = () =>
  readFileSync("components/roadmap/roadmap-view.tsx", "utf8");

describe("roadmap source-level regressions", () => {
  it("keeps lane names non-clickable so retired epic routes do not 404", () => {
    const src = roadmapView();

    expect(src).toContain("data-testid=\"lane-epic-header-label\"");
    expect(src).not.toContain("data-testid=\"lane-epic-header-link\"");
  });

  it("invalidates the workspace snapshot when board CDC events arrive", () => {
    const src = roadmapView();

    expect(src).toContain('table: "boards"');
    expect(src).toContain("workspaceSnapshotKeys.workspace(workspaceId)");
    expect(src).toContain("invalidateQueries");
  });
});
