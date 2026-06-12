import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roadmapView = () =>
  readFileSync("components/roadmap/roadmap-view.tsx", "utf8");

describe("roadmap source-level regressions", () => {
  it("lane names link only to live board routes, never retired epic routes", () => {
    const src = roadmapView();

    // Lane labels were made clickable on purpose — but only as board
    // links (boardHref + "Open board" aria). The original 404 hazard was
    // links into retired epic routes; keep asserting those never return.
    expect(src).toContain('"lane-header-label"');
    expect(src).toContain("aria-label={`Open board ${ll.lane.title}`}");
    expect(src).not.toContain("lane-epic-header-link");
    expect(src).not.toMatch(/href=\{?[`"']\/e(pics)?\//);
  });

  it("invalidates the workspace snapshot when board CDC events arrive", () => {
    const src = roadmapView();

    expect(src).toContain('table: "boards"');
    expect(src).toContain("workspaceSnapshotKeys.workspace(workspaceId)");
    expect(src).toContain("invalidateQueries");
  });
});
