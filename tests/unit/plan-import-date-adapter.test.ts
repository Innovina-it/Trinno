import { describe, it, expect } from "vitest";
import { isoToDate, dateToIso } from "@/lib/plan-import/date-adapter";

describe("isoToDate", () => {
  it("parses a YYYY-MM-DD string to a UTC-noon Date on that calendar day", () => {
    const d = isoToDate("2026-06-30");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(5); // June
    expect(d!.getUTCDate()).toBe(30);
  });
  it("returns null for blank or malformed input (mid-typing tolerance)", () => {
    expect(isoToDate("")).toBeNull();
    expect(isoToDate("2026-6-3")).toBeNull();
    expect(isoToDate("June 2026")).toBeNull();
  });
});

describe("dateToIso", () => {
  it("formats a Date to YYYY-MM-DD", () => {
    expect(dateToIso(new Date("2026-06-30T12:00:00Z"))).toBe("2026-06-30");
  });
  it("returns empty string for null", () => {
    expect(dateToIso(null)).toBe("");
  });
});

describe("round-trip", () => {
  it("iso → Date → iso is stable across the day boundary", () => {
    expect(dateToIso(isoToDate("2026-01-01"))).toBe("2026-01-01");
    expect(dateToIso(isoToDate("2027-12-31"))).toBe("2027-12-31");
  });
});
