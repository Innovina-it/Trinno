import { describe, it, expect } from "vitest";
import { projectSpanMonths, rescalePlanDuration } from "@/lib/plan-import/rescale";
import type { ProjectPlan } from "@/lib/plan-import/types";

const plan: ProjectPlan = {
  workspaceName: "X",
  parentBoardTitle: "X",
  workPackages: [
    {
      code: "WP1",
      title: "WP1",
      option: "RI",
      start: "2026-01-01",
      end: "2026-12-31",
      description: "",
      tasks: [{ title: "T1.1", description: "" }],
      deliverables: [{ title: "D1.1", taskIndex: 0, due: "2026-07-01", month: 6, description: "" }],
    },
  ],
  // latest date in the plan — defines the span end (earliest start → latest end).
  milestones: [{ name: "M", date: "2027-06-30", description: "" }],
};

describe("projectSpanMonths", () => {
  it("measures earliest start to latest end in whole months", () => {
    expect(projectSpanMonths(plan)).toBe(18); // 2026-01-01 → 2027-06-30 ≈ 18 months
  });
  it("returns 0 when there are not enough dates to span", () => {
    const empty: ProjectPlan = { ...plan, workPackages: [], milestones: [] };
    expect(projectSpanMonths(empty)).toBe(0);
  });
});

describe("rescalePlanDuration", () => {
  it("proportionally stretches every date from a fixed start (18 → 36 doubles offsets)", () => {
    const r = rescalePlanDuration(plan, 36);
    expect(projectSpanMonths(r)).toBe(36);
    // start stays fixed (offset 0)
    expect(r.workPackages[0].start).toBe("2026-01-01");
    // the deliverable's month-number recomputes from its new date (≈ doubled)
    expect(r.workPackages[0].deliverables[0].month).toBe(12);
    // the milestone (span end) moves out to ~36 months from start
    expect(r.milestones[0].date > plan.milestones[0].date).toBe(true);
  });

  it("shrinks proportionally too (18 → 9 halves offsets)", () => {
    const r = rescalePlanDuration(plan, 9);
    expect(projectSpanMonths(r)).toBe(9);
    expect(r.workPackages[0].start).toBe("2026-01-01");
  });

  it("is a no-op for an out-of-range duration or an undateable plan", () => {
    expect(rescalePlanDuration(plan, 0)).toEqual(plan);
    const empty: ProjectPlan = { ...plan, workPackages: [], milestones: [] };
    expect(rescalePlanDuration(empty, 24)).toEqual(empty);
  });
});
