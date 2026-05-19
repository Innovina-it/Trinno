import { describe, it, expect } from "vitest";
import { mergeHolidays, holidaysInRange } from "@/lib/holidays/merge";
import type { Holiday } from "@/lib/holidays/it";

const PRESETS: Holiday[] = [
  { iso: "2026-04-05", name: "Pasqua" },
  { iso: "2026-04-06", name: "Lunedì dell'Angelo" },
  { iso: "2026-08-15", name: "Ferragosto" },
];

describe("mergeHolidays", () => {
  it("returns presets unchanged with no overrides", () => {
    expect(mergeHolidays(PRESETS, [])).toEqual(PRESETS);
  });

  it("mutes a preset when name is null", () => {
    const out = mergeHolidays(PRESETS, [
      { isoDate: "2026-08-15", name: null },
    ]);
    expect(out.map((h) => h.iso)).toEqual(["2026-04-05", "2026-04-06"]);
  });

  it("renames a preset when name is not null on the same iso", () => {
    const out = mergeHolidays(PRESETS, [
      { isoDate: "2026-04-05", name: "Easter Sunday" },
    ]);
    const easter = out.find((h) => h.iso === "2026-04-05");
    expect(easter?.name).toBe("Easter Sunday");
    expect(out).toHaveLength(3);
  });

  it("adds a custom day when iso is not in presets", () => {
    const out = mergeHolidays(PRESETS, [
      { isoDate: "2026-08-17", name: "Chiusura aziendale" },
    ]);
    expect(out.map((h) => h.iso)).toEqual([
      "2026-04-05",
      "2026-04-06",
      "2026-08-15",
      "2026-08-17",
    ]);
    expect(out.at(-1)?.name).toBe("Chiusura aziendale");
  });

  it("handles mute + add together, sorted chronologically", () => {
    const out = mergeHolidays(PRESETS, [
      { isoDate: "2026-04-06", name: null },
      { isoDate: "2026-01-01", name: "Capodanno (custom)" },
    ]);
    expect(out.map((h) => h.iso)).toEqual([
      "2026-01-01",
      "2026-04-05",
      "2026-08-15",
    ]);
  });
});

describe("holidaysInRange (generic over list)", () => {
  it("filters by inclusive bounds", () => {
    const out = holidaysInRange(
      PRESETS,
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-30T00:00:00Z"),
    );
    expect(out.map((h) => h.name)).toEqual(["Pasqua", "Lunedì dell'Angelo"]);
  });

  it("returns UTC-midnight Date objects", () => {
    const out = holidaysInRange(
      PRESETS,
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-31T00:00:00Z"),
    );
    expect(out).toHaveLength(1);
    expect(out[0].date.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("works on merged list including custom days", () => {
    const merged = mergeHolidays(PRESETS, [
      { isoDate: "2026-08-17", name: "Chiusura" },
    ]);
    const out = holidaysInRange(
      merged,
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-31T00:00:00Z"),
    );
    expect(out.map((h) => h.name)).toEqual(["Ferragosto", "Chiusura"]);
  });
});
