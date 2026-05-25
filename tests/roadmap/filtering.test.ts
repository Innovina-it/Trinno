import { describe, expect, it } from "vitest";
import type { Filters } from "@/lib/board-filters";
import {
  countMineHiddenRoadmapCards,
  roadmapUserFilterPasses,
  type RoadmapFilterCard,
} from "@/lib/roadmap/filtering";

const baseFilters: Filters = {
  types: [],
  labelIds: [],
  due: null,
  assignedToMe: false,
  unassigned: false,
  scheduled: false,
  hideCompleted: false,
  showDates: false,
};

function card(id: string, ownerId: string | null): RoadmapFilterCard {
  return {
    id,
    title: `Card ${id}`,
    archived: false,
    type: "task",
    sprintId: null,
    dueDate: null,
    dueComplete: false,
    startDate: new Date("2026-05-14T00:00:00.000Z"),
    targetDate: new Date("2026-05-15T00:00:00.000Z"),
    ownerId,
  };
}

describe("roadmap filtering", () => {
  it("allows unassigned cards when the assignee filter is permissive", () => {
    expect(
      roadmapUserFilterPasses(card("unassigned", null), {
        queryNorm: "",
        filters: baseFilters,
        sprintFilter: "",
        viewerId: "u1",
        memberByCard: new Map(),
      }),
    ).toBe(true);
  });

  it("counts cards hidden only by Mine for the +N badge", () => {
    const memberByCard = new Map<string, Set<string>>([
      ["mine-by-member", new Set(["u1"])],
    ]);
    const hidden = countMineHiddenRoadmapCards(
      [card("mine-by-owner", "u1"), card("mine-by-member", null), card("other", "u2"), card("unassigned", null)],
      {
        queryNorm: "",
        filters: { ...baseFilters, assignedToMe: true },
        sprintFilter: "",
        viewerId: "u1",
        memberByCard,
        requireScheduled: true,
      },
    );

    expect(hidden).toBe(2);
  });
});
