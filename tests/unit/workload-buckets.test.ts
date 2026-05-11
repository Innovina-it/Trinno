import { describe, it, expect } from "vitest";
import {
  bucketsBetween,
  fillBuckets,
  isoWeek,
  startOfIsoWeekUtc,
} from "@/lib/workload/buckets";

describe("workload buckets", () => {
  it("startOfIsoWeekUtc snaps to Monday 00:00 UTC", () => {
    const wed = new Date("2026-01-07T15:30:00Z");
    const mon = startOfIsoWeekUtc(wed);
    expect(mon.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("isoWeek matches ISO 8601", () => {
    expect(isoWeek(new Date("2026-01-05T00:00:00Z"))).toEqual({
      year: 2026,
      week: 2,
    });
    expect(isoWeek(new Date("2025-12-29T00:00:00Z"))).toEqual({
      year: 2026,
      week: 1,
    });
  });

  it("bucketsBetween covers inclusive range", () => {
    const buckets = bucketsBetween(
      new Date("2026-01-05T00:00:00Z"),
      new Date("2026-01-19T00:00:00Z"),
    );
    expect(buckets.length).toBe(3);
    expect(buckets[0].start.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(buckets[2].start.toISOString()).toBe("2026-01-19T00:00:00.000Z");
  });

  it("fillBuckets distributes estimate proportionally", () => {
    const buckets = bucketsBetween(
      new Date("2026-01-05T00:00:00Z"),
      new Date("2026-01-19T00:00:00Z"),
    );
    fillBuckets(buckets, [
      {
        id: "a",
        startDate: new Date("2026-01-05T00:00:00Z"),
        targetDate: new Date("2026-01-18T00:00:00Z"),
        estimateMin: 1400, // 14 days, 100/day
      },
    ]);
    const total = buckets.reduce((s, b) => s + b.load, 0);
    // Card span fits entirely within first two weeks → ~all load there.
    expect(buckets[2].load).toBe(0);
    expect(Math.round(total)).toBeGreaterThan(1300);
  });

  it("fillBuckets falls back to fractional load when estimate is null", () => {
    const buckets = bucketsBetween(
      new Date("2026-01-05T00:00:00Z"),
      new Date("2026-01-19T00:00:00Z"),
    );
    fillBuckets(buckets, [
      {
        id: "a",
        startDate: new Date("2026-01-05T00:00:00Z"),
        targetDate: new Date("2026-01-11T00:00:00Z"),
        estimateMin: null,
      },
    ]);
    expect(buckets[0].load).toBeGreaterThan(0);
    expect(buckets[1].load).toBe(0);
  });
});
