import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Mine hidden-card badge moved from RoadmapFilterBar into the shared
// AssigneeFilterRow (components/filters/) used by roadmap, board and
// timeline. The invariant is unchanged: the badge renders from a
// supplied hidden-count and tells the user how to reveal the cards.
describe("Mine hidden-card badge", () => {
  it("AssigneeFilterRow renders the badge from the supplied count", () => {
    const src = readFileSync(
      "components/filters/assignee-filter-row.tsx",
      "utf8",
    );

    expect(src).toContain("hiddenCount");
    expect(src).toContain("assignee-filter-hidden-badge");
    expect(src).toContain("more not shown");
  });

  it("roadmap view supplies its mine-hidden count to the row", () => {
    const src = readFileSync("components/roadmap/roadmap-view.tsx", "utf8");

    expect(src).toContain("mineHiddenCount");
    expect(src).toContain("hiddenCount={mineHiddenCount}");
  });
});
