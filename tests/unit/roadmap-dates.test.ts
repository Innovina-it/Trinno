import { describe, it, expect } from "vitest";
import {
  startOfDay,
  addDays,
  dayDiff,
  pixelsPerDay,
  gridStartFor,
  gridEndFor,
  preservedScrollLeft,
  xForDate,
} from "@/lib/roadmap/dates";

describe("startOfDay / addDays / dayDiff", () => {
  it("startOfDay strips time component", () => {
    const d = new Date("2026-04-30T15:42:11Z");
    expect(startOfDay(d).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });
  it("addDays adds N calendar days", () => {
    expect(addDays(new Date("2026-04-30T00:00:00Z"), 5).toISOString()).toBe(
      "2026-05-05T00:00:00.000Z",
    );
  });
  it("addDays accepts negative N", () => {
    expect(addDays(new Date("2026-05-05T00:00:00Z"), -3).toISOString()).toBe(
      "2026-05-02T00:00:00.000Z",
    );
  });
  it("dayDiff returns whole-day delta", () => {
    expect(
      dayDiff(new Date("2026-04-30T00:00:00Z"), new Date("2026-05-05T00:00:00Z")),
    ).toBe(5);
    expect(
      dayDiff(new Date("2026-05-05T00:00:00Z"), new Date("2026-04-30T00:00:00Z")),
    ).toBe(-5);
  });
});

describe("zoom + grid bounds", () => {
  it("pixelsPerDay scales with zoom", () => {
    expect(pixelsPerDay("week")).toBe(60);
    expect(pixelsPerDay("month")).toBe(24);
    expect(pixelsPerDay("quarter")).toBe(8);
  });
  it("gridStartFor week snaps backward to the previous Monday (UTC)", () => {
    // 2026-05-15 is a Friday in UTC — Monday is 2026-05-11.
    const ref = new Date("2026-05-15T12:00:00Z");
    expect(gridStartFor(ref, "week").toISOString().slice(0, 10)).toBe(
      "2026-05-11",
    );
  });
  it("gridStartFor week handles Sunday correctly (Monday is 6 days back)", () => {
    // 2026-05-17 is a Sunday in UTC — Monday is 2026-05-11.
    const ref = new Date("2026-05-17T03:00:00Z");
    expect(gridStartFor(ref, "week").toISOString().slice(0, 10)).toBe(
      "2026-05-11",
    );
  });
  it("gridStartFor month snaps to first of month (UTC)", () => {
    const ref = new Date("2026-05-15T12:00:00Z");
    expect(gridStartFor(ref, "month").toISOString().slice(0, 10)).toBe(
      "2026-05-01",
    );
  });
  it("gridStartFor quarter snaps to first day of Jan/Apr/Jul/Oct (UTC)", () => {
    expect(
      gridStartFor(new Date("2026-05-15T12:00:00Z"), "quarter")
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-04-01");
    expect(
      gridStartFor(new Date("2026-02-01T00:00:00Z"), "quarter")
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-01-01");
    expect(
      gridStartFor(new Date("2026-09-30T00:00:00Z"), "quarter")
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-07-01");
    expect(
      gridStartFor(new Date("2026-11-15T00:00:00Z"), "quarter")
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-01");
  });
  it("gridEndFor returns at least 6 months ahead of start regardless of zoom", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    expect(dayDiff(start, gridEndFor(start, "week"))).toBeGreaterThanOrEqual(180);
    expect(dayDiff(start, gridEndFor(start, "month"))).toBeGreaterThanOrEqual(180);
    expect(dayDiff(start, gridEndFor(start, "quarter"))).toBeGreaterThanOrEqual(180);
  });
});

describe("xForDate", () => {
  it("computes pixels = (date - gridStart) * pixelsPerDay", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const ppd = pixelsPerDay("month"); // 24
    expect(xForDate(new Date("2026-05-11T00:00:00Z"), start, ppd)).toBe(240);
    expect(xForDate(new Date("2026-05-01T00:00:00Z"), start, ppd)).toBe(0);
  });
  it("handles negative offsets (date before gridStart)", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    expect(xForDate(new Date("2026-04-29T00:00:00Z"), start, 24)).toBe(-48);
  });
});

describe("preservedScrollLeft (anchor-preserving zoom)", () => {
  const grid = new Date("2025-06-01T00:00:00Z");

  it("keeps the center date fixed when zooming IN (same grid)", () => {
    // prevScrollLeft 500 + half of 1000 = centerPx 1000; at 10 ppd that is
    // day index 100 from gridStart. At 20 ppd the same day sits at px 2000,
    // so scrollLeft must be 2000 - 500 = 1500.
    const next = preservedScrollLeft(500, 1000, grid, 10, grid, 20, 100_000);
    expect(next).toBe(1500);
    // The same center day under the new geometry.
    expect((next + 1000 / 2) / 20).toBe(100);
  });

  it("keeps the center date fixed when zooming OUT (same grid)", () => {
    // centerPx 2000 at 10 ppd = day 200; at 5 ppd → 1000 - 500 = 500.
    const next = preservedScrollLeft(1500, 1000, grid, 10, grid, 5, 100_000);
    expect(next).toBe(500);
    expect((next + 1000 / 2) / 5).toBe(200);
  });

  it("clamps to 0 at the start edge", () => {
    // centerPx 700 at 10 ppd = day 70; at 2 ppd → 140 - 500 = -360 → 0.
    expect(preservedScrollLeft(200, 1000, grid, 10, grid, 2, 100_000)).toBe(0);
  });

  it("clamps to maxScrollLeft at the end edge", () => {
    // centerPx 5500 at 10 ppd = day 550; at 40 ppd → 22000 - 500 = 21500,
    // but maxScrollLeft is 10000, so it clamps.
    expect(preservedScrollLeft(5000, 1000, grid, 10, grid, 40, 10_000)).toBe(
      10_000,
    );
  });

  it("accounts for a grid-origin shift", () => {
    // Same ppd, but the new grid starts 31 days earlier (2025-05-01). The
    // center day (100 from the old grid) becomes 131 from the new grid, so
    // scrollLeft = 131*10 - 500 = 810.
    const nextGrid = new Date("2025-05-01T00:00:00Z");
    expect(preservedScrollLeft(500, 1000, grid, 10, nextGrid, 10, 100_000)).toBe(
      810,
    );
  });

  it("falls back to a clamped prev scrollLeft when a ppd is non-positive", () => {
    expect(preservedScrollLeft(900, 1000, grid, 0, grid, 20, 500)).toBe(500);
    expect(preservedScrollLeft(300, 1000, grid, 10, grid, 0, 500)).toBe(300);
  });
});
