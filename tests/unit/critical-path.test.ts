import { describe, it, expect } from "vitest";
import { criticalPath, type CardWithDates, type Link } from "@/lib/roadmap/critical-path";

const dayMs = 86_400_000;
function d(daysFromEpoch: number): Date {
  return new Date(daysFromEpoch * dayMs);
}

function card(id: string, start: number, end: number): CardWithDates {
  return { id, startDate: d(start), targetDate: d(end) };
}

describe("criticalPath", () => {
  it("empty input → empty critical set", () => {
    const r = criticalPath([], []);
    expect(r.critical.size).toBe(0);
    expect(r.longestDays).toBe(0);
  });

  it("single chain A→B→C marks all three cards critical", () => {
    // Each card spans 5 days. The chain length is 5+5+5 = 15.
    const cards = [card("A", 0, 5), card("B", 5, 10), card("C", 10, 15)];
    // is_blocked_by row {from, to} = "from is blocked by to". So:
    //   B is blocked by A → edge A→B
    //   C is blocked by B → edge B→C
    const links: Link[] = [
      { from: "B", to: "A", kind: "is_blocked_by" },
      { from: "C", to: "B", kind: "is_blocked_by" },
    ];
    const r = criticalPath(cards, links);
    expect(r.longestDays).toBe(15);
    expect(r.critical.has("A")).toBe(true);
    expect(r.critical.has("B")).toBe(true);
    expect(r.critical.has("C")).toBe(true);
  });

  it("branching DAG marks only the longer chain critical", () => {
    // A is the shared blocker. Two branches:
    //   long branch:  A(2d) → B(10d) → D(3d)  total 15
    //   short branch: A(2d) → C(1d)  total 3
    const cards = [
      card("A", 0, 2),
      card("B", 2, 12),
      card("C", 2, 3),
      card("D", 12, 15),
    ];
    const links: Link[] = [
      { from: "B", to: "A", kind: "is_blocked_by" },
      { from: "C", to: "A", kind: "is_blocked_by" },
      { from: "D", to: "B", kind: "is_blocked_by" },
    ];
    const r = criticalPath(cards, links);
    expect(r.longestDays).toBe(15);
    expect(r.critical.has("A")).toBe(true);
    expect(r.critical.has("B")).toBe(true);
    expect(r.critical.has("D")).toBe(true);
    expect(r.critical.has("C")).toBe(false);
  });
});
