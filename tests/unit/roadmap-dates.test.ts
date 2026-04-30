import { describe, it, expect } from "vitest";
import {
  startOfDay,
  addDays,
  dayDiff,
  pixelsPerDay,
  gridStartFor,
  gridEndFor,
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
