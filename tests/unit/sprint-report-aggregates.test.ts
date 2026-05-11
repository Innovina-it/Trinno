import { describe, it, expect } from "vitest";
import {
  aggregateSprintReport,
  completionRate,
} from "@/lib/queries/sprint-report";

// Plan #16b — sprint completion report. These tests pin the per-card
// bucketing rules ("added mid-sprint" vs "carried over") so a future
// reword of the rule breaks here instead of silently shifting numbers
// in the report UI. The underlying point sources (`computeBurndown`,
// `computeVelocity`) have their own DB-backed integration tests; here
// we only test the pure aggregator.

const start = new Date("2026-05-01T00:00:00Z");
const end = new Date("2026-05-15T00:00:00Z");
const closed = new Date("2026-05-15T17:00:00Z");

describe("aggregateSprintReport", () => {
  it("buckets cards present at sprint start as committed (not mid-sprint)", () => {
    const cards = [
      { id: "a", storyPoints: 3, completedAt: new Date("2026-05-10T12:00:00Z") },
      { id: "b", storyPoints: 5, completedAt: null },
    ];
    const history = [
      // Both assigned at sprint start (within grace).
      { cardId: "a", assignedAt: new Date("2026-05-01T00:00:00Z") },
      { cardId: "b", assignedAt: new Date("2026-05-01T00:30:00Z") },
    ];

    const out = aggregateSprintReport(cards, history, {
      startDate: start,
      endDate: end,
      completedAt: closed,
    });

    expect(out.cardsAddedMidSprint).toBe(0);
    expect(out.committedPoints).toBe(8);
    expect(out.cardsCompleted).toBe(1);
    expect(out.cardsCarriedOver).toBe(1);
    expect(out.byCard.get("a")?.completedInSprint).toBe(true);
    expect(out.byCard.get("b")?.completedInSprint).toBe(false);
  });

  it("flags cards assigned after start (past grace) as added mid-sprint", () => {
    const cards = [
      { id: "a", storyPoints: 3, completedAt: new Date("2026-05-10T12:00:00Z") },
      { id: "c", storyPoints: 2, completedAt: new Date("2026-05-12T12:00:00Z") },
    ];
    const history = [
      { cardId: "a", assignedAt: new Date("2026-05-01T00:00:00Z") },
      // Added on day 5 — past 1h grace.
      { cardId: "c", assignedAt: new Date("2026-05-05T09:00:00Z") },
    ];

    const out = aggregateSprintReport(cards, history, {
      startDate: start,
      endDate: end,
      completedAt: closed,
    });

    expect(out.cardsAddedMidSprint).toBe(1);
    expect(out.byCard.get("c")?.addedMidSprint).toBe(true);
    // Mid-sprint cards are EXCLUDED from committedPoints.
    expect(out.committedPoints).toBe(3);
  });

  it("treats cards completed AFTER sprint close as carried over", () => {
    const cards = [
      // Completed 3 days after the sprint closed.
      { id: "a", storyPoints: 3, completedAt: new Date("2026-05-18T09:00:00Z") },
    ];
    const history = [
      { cardId: "a", assignedAt: new Date("2026-05-01T00:00:00Z") },
    ];

    const out = aggregateSprintReport(cards, history, {
      startDate: start,
      endDate: end,
      completedAt: closed,
    });

    expect(out.cardsCompleted).toBe(0);
    expect(out.cardsCarriedOver).toBe(1);
    expect(out.byCard.get("a")?.completedInSprint).toBe(false);
  });

  it("handles cards with no history rows as committed-at-start", () => {
    // Defensive: history may be empty (e.g. older sprints before the
    // 0089 backfill). Aggregator must still bucket them as committed
    // rather than crashing or treating them as mid-sprint.
    const cards = [
      { id: "a", storyPoints: 4, completedAt: new Date("2026-05-10T12:00:00Z") },
    ];
    const out = aggregateSprintReport(cards, [], {
      startDate: start,
      endDate: end,
      completedAt: closed,
    });

    expect(out.cardsAddedMidSprint).toBe(0);
    expect(out.committedPoints).toBe(4);
    expect(out.byCard.get("a")?.addedMidSprint).toBe(false);
  });

  it("returns zeros when sprintCards is empty", () => {
    const out = aggregateSprintReport([], [], {
      startDate: start,
      endDate: end,
      completedAt: closed,
    });
    expect(out.cardsCompleted).toBe(0);
    expect(out.cardsAddedMidSprint).toBe(0);
    expect(out.cardsCarriedOver).toBe(0);
    expect(out.committedPoints).toBe(0);
    expect(out.byCard.size).toBe(0);
  });
});

describe("completionRate", () => {
  it("uses committedPoints as denominator when known", () => {
    expect(completionRate(8, 10, 12)).toBe(80);
  });

  it("falls back to totalPoints when committedPoints is 0", () => {
    expect(completionRate(3, 0, 6)).toBe(50);
  });

  it("returns 0 when both committed and total are 0", () => {
    expect(completionRate(0, 0, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(completionRate(1, 3, 0)).toBe(33);
    expect(completionRate(2, 3, 0)).toBe(67);
  });
});
