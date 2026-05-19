import { describe, it, expect } from "vitest";
import { holidayName, holidaysInRange } from "@/lib/holidays/it";

describe("holidayName", () => {
  it("returns name for a known holiday", () => {
    expect(holidayName(new Date("2026-12-25T00:00:00Z"))).toBe("Natale");
    expect(holidayName(new Date("2026-04-06T00:00:00Z"))).toBe(
      "Lunedì dell'Angelo",
    );
  });

  it("returns undefined for a non-holiday", () => {
    expect(holidayName(new Date("2026-03-15T00:00:00Z"))).toBeUndefined();
  });

  it("is timezone-invariant: lookup uses UTC date portion", () => {
    // 23:30 local on the 25th in UTC+1 is still 22:30 UTC on the 25th.
    expect(holidayName(new Date("2026-12-25T22:30:00Z"))).toBe("Natale");
  });
});

describe("holidaysInRange", () => {
  it("includes both bounds", () => {
    const start = new Date("2026-12-25T00:00:00Z");
    const end = new Date("2026-12-26T00:00:00Z");
    const out = holidaysInRange(start, end);
    expect(out.map((h) => h.name)).toEqual(["Natale", "Santo Stefano"]);
  });

  it("returns empty when no holiday falls inside", () => {
    const start = new Date("2026-02-01T00:00:00Z");
    const end = new Date("2026-02-28T00:00:00Z");
    expect(holidaysInRange(start, end)).toEqual([]);
  });

  it("returns chronologically ordered Date objects at UTC midnight", () => {
    const start = new Date("2026-04-01T00:00:00Z");
    const end = new Date("2026-05-02T00:00:00Z");
    const out = holidaysInRange(start, end);
    expect(out.length).toBeGreaterThan(0);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].date.getTime()).toBeGreaterThan(out[i - 1].date.getTime());
    }
    for (const h of out) {
      expect(h.date.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
    }
  });

  it("spans multiple years", () => {
    const start = new Date("2025-12-20T00:00:00Z");
    const end = new Date("2026-01-10T00:00:00Z");
    const names = holidaysInRange(start, end).map((h) => h.name);
    expect(names).toContain("Natale");
    expect(names).toContain("Santo Stefano");
    expect(names).toContain("Capodanno");
    expect(names).toContain("Epifania");
  });
});
