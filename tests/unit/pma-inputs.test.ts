import { describe, it, expect, vi } from "vitest";

// U9 inputs — the pure roadmap-shaping helpers (toIso / groupAssignees /
// buildEntries). The DB client is mocked so importing the module is
// side-effect-free; getRunInputs itself is DB glue covered by the run smoke.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ dbAsUser: vi.fn() }));

import { toIso, groupAssignees, buildEntries } from "@/lib/pma/inputs";

describe("toIso", () => {
  it("converts a Date to an ISO string", () => {
    expect(toIso(new Date("2026-06-08T10:00:00.000Z"))).toBe("2026-06-08T10:00:00.000Z");
  });
  it("passes a string through and nulls everything else", () => {
    expect(toIso("2026-06-08T10:00:00Z")).toBe("2026-06-08T10:00:00Z");
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
    expect(toIso(123)).toBeNull();
  });
});

describe("groupAssignees", () => {
  it("groups userIds by cardId preserving multiples", () => {
    const m = groupAssignees([
      { cardId: "c1", userId: "u1" },
      { cardId: "c1", userId: "u2" },
      { cardId: "c2", userId: "u3" },
    ]);
    expect(m.get("c1")).toEqual(["u1", "u2"]);
    expect(m.get("c2")).toEqual(["u3"]);
    expect(m.has("c3")).toBe(false);
  });
});

describe("buildEntries", () => {
  it("shapes card + assignee rows into BaselineEntry[] with ISO dates and grouped assignees", () => {
    const entries = buildEntries(
      [
        {
          cardId: "c1",
          title: "Ship onboarding",
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          targetDate: new Date("2026-06-01T00:00:00.000Z"),
          completedAt: null,
          roadmapOrder: 1,
          sprintId: "sprint-1",
          parentCardId: null,
        },
        {
          cardId: "c2",
          title: "No dates",
          startDate: null,
          targetDate: null,
          completedAt: null,
          roadmapOrder: null,
          sprintId: null,
          parentCardId: null,
        },
      ],
      [
        { cardId: "c1", userId: "u1" },
        { cardId: "c1", userId: "u2" },
      ],
    );

    expect(entries[0]).toEqual({
      cardId: "c1",
      title: "Ship onboarding",
      startDate: "2026-05-01T00:00:00.000Z",
      targetDate: "2026-06-01T00:00:00.000Z",
      completedAt: null,
      roadmapOrder: 1,
      sprintId: "sprint-1",
      parentCardId: null,
      assignees: ["u1", "u2"],
    });
    // a card with no assignees gets an empty array, not undefined
    expect(entries[1].assignees).toEqual([]);
  });
});
