import { describe, it, expect } from "vitest";
import { compareToBaseline } from "@/lib/baselines/compare";
import type {
  BaselineDetail,
  BaselineEntry,
  BaselineMeta,
  BaselineMilestone,
  LiveEntry,
  LiveMilestone,
} from "@/lib/baselines/types";

const meta: BaselineMeta = {
  id: "b1",
  workspaceId: "w1",
  name: "Snapshot",
  note: null,
  createdBy: "u1",
  createdAt: "2026-05-01T00:00:00Z",
};

function entry(p: Partial<BaselineEntry> & { cardId: string }): BaselineEntry {
  return {
    cardId: p.cardId,
    title: p.title ?? p.cardId,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    completedAt: p.completedAt ?? null,
    roadmapOrder: p.roadmapOrder ?? null,
    sprintId: p.sprintId ?? null,
    parentCardId: p.parentCardId ?? null,
    assignees: p.assignees ?? [],
  };
}

function ms(p: Partial<BaselineMilestone> & { milestoneId: string }): BaselineMilestone {
  return {
    milestoneId: p.milestoneId,
    name: p.name ?? p.milestoneId,
    date: p.date ?? null,
  };
}

function baseline(
  entries: BaselineEntry[],
  milestones: BaselineMilestone[] = [],
): BaselineDetail {
  return { meta, entries, milestones };
}

function live(entries: LiveEntry[], milestones: LiveMilestone[] = []) {
  return { entries, milestones };
}

describe("compareToBaseline", () => {
  it("flags a slipped target date with positive delta", () => {
    const base = baseline([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z" })]);
    const result = compareToBaseline(
      live([entry({ cardId: "c1", targetDate: "2026-06-20T00:00:00Z" })]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.targetDeltaDays).toBe(19);
    expect(c.status).toBe("slipped");
  });

  it("flags a pulled-in target date with negative delta", () => {
    const base = baseline([entry({ cardId: "c1", targetDate: "2026-06-20T00:00:00Z" })]);
    const result = compareToBaseline(
      live([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z" })]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.targetDeltaDays).toBe(-19);
    expect(c.status).toBe("pulled_in");
  });

  it("marks identical entries as unchanged with zero delta", () => {
    const e = { cardId: "c1", targetDate: "2026-06-01T00:00:00Z", roadmapOrder: 3 };
    const result = compareToBaseline(live([entry(e)]), baseline([entry(e)]));
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.status).toBe("unchanged");
    expect(c.targetDeltaDays).toBe(0);
  });

  it("flags completed_since with precedence over a date delta", () => {
    const base = baseline([
      entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z", completedAt: null }),
    ]);
    const result = compareToBaseline(
      live([
        entry({
          cardId: "c1",
          targetDate: "2026-06-20T00:00:00Z",
          completedAt: "2026-06-15T00:00:00Z",
        }),
      ]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.status).toBe("completed_since");
  });

  it("flags an added card with its assignees", () => {
    const result = compareToBaseline(
      live([entry({ cardId: "c2", assignees: ["a", "b"] })]),
      baseline([]),
    );
    const c = result.cards.find((x) => x.cardId === "c2")!;
    expect(c.status).toBe("added");
    expect(c.assigneesAdded).toEqual(["a", "b"]);
  });

  it("flags a removed card with its assignees", () => {
    const result = compareToBaseline(
      live([]),
      baseline([entry({ cardId: "c3", assignees: ["x", "y"] })]),
    );
    const c = result.cards.find((x) => x.cardId === "c3")!;
    expect(c.status).toBe("removed");
    expect(c.assigneesRemoved).toEqual(["x", "y"]);
  });

  it("flags a reordered card when only roadmapOrder changes", () => {
    const base = baseline([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z", roadmapOrder: 1 })]);
    const result = compareToBaseline(
      live([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z", roadmapOrder: 5 })]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.status).toBe("reordered");
  });

  it("returns null target delta when one side is undated (no crash)", () => {
    const base = baseline([entry({ cardId: "c1", targetDate: null })]);
    const result = compareToBaseline(
      live([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z" })]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.targetDeltaDays).toBeNull();
  });

  it("computes assignee diffs", () => {
    const base = baseline([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z", assignees: ["a", "c"] })]);
    const result = compareToBaseline(
      live([entry({ cardId: "c1", targetDate: "2026-06-01T00:00:00Z", assignees: ["a", "b"] })]),
      base,
    );
    const c = result.cards.find((x) => x.cardId === "c1")!;
    expect(c.assigneesAdded).toEqual(["b"]);
    expect(c.assigneesRemoved).toEqual(["c"]);
  });

  it("handles milestone moved / added / removed", () => {
    const base = baseline(
      [],
      [
        ms({ milestoneId: "m1", date: "2026-06-01T00:00:00Z" }),
        ms({ milestoneId: "m3", date: "2026-06-10T00:00:00Z" }),
      ],
    );
    const result = compareToBaseline(
      live(
        [],
        [
          ms({ milestoneId: "m1", date: "2026-06-05T00:00:00Z" }),
          ms({ milestoneId: "m2", date: "2026-07-01T00:00:00Z" }),
        ],
      ),
      base,
    );
    const m1 = result.milestones.find((m) => m.milestoneId === "m1")!;
    const m2 = result.milestones.find((m) => m.milestoneId === "m2")!;
    const m3 = result.milestones.find((m) => m.milestoneId === "m3")!;
    expect(m1.status).toBe("moved");
    expect(m1.dateDeltaDays).toBe(4);
    expect(m2.status).toBe("added");
    expect(m3.status).toBe("removed");
  });

  it("rolls up counts and worst slip", () => {
    const base = baseline([
      entry({ cardId: "slip", targetDate: "2026-06-01T00:00:00Z" }),
      entry({ cardId: "slip2", targetDate: "2026-06-01T00:00:00Z" }),
      entry({ cardId: "pull", targetDate: "2026-06-20T00:00:00Z" }),
      entry({ cardId: "rem", assignees: ["z"] }),
      entry({ cardId: "done", targetDate: "2026-06-01T00:00:00Z", completedAt: null }),
    ]);
    const result = compareToBaseline(
      live([
        entry({ cardId: "slip", targetDate: "2026-06-11T00:00:00Z" }), // +10
        entry({ cardId: "slip2", targetDate: "2026-06-06T00:00:00Z" }), // +5
        entry({ cardId: "pull", targetDate: "2026-06-10T00:00:00Z" }), // -10
        entry({ cardId: "add", assignees: ["q"] }),
        entry({ cardId: "done", targetDate: "2026-06-01T00:00:00Z", completedAt: "2026-05-30T00:00:00Z" }),
      ]),
      base,
    );
    expect(result.rollup.slipped).toBe(2);
    expect(result.rollup.pulledIn).toBe(1);
    expect(result.rollup.added).toBe(1);
    expect(result.rollup.removed).toBe(1);
    expect(result.rollup.completedSince).toBe(1);
    expect(result.rollup.worstSlipDays).toBe(10);
  });
});
