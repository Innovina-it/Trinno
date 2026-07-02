import { describe, it, expect } from "vitest";

// U4 (eval #1) — period presets for the Run-analysis panel. The reviewed run
// used the calendar-arbitrary YTD preset; with roadmap dates available a
// "Project" preset (project start → today) is offered first.
import {
  buildPresets,
  rangeMatches,
  startOfDayUTC,
} from "@/lib/pma/analysis-presets";

const NOW = new Date("2026-07-02T10:30:00Z");

describe("buildPresets", () => {
  it("keeps the four calendar presets when no project range is given", () => {
    const labels = buildPresets(NOW).map((p) => p.label);
    expect(labels).toEqual(["This month", "Last month", "Quarter", "YTD"]);
  });

  it("offers the Project preset FIRST when the roadmap has a past start date", () => {
    const presets = buildPresets(NOW, { start: "2026-05-18T00:00:00Z", end: "2027-12-15T00:00:00Z" });
    expect(presets[0].label).toBe("Project");
    expect(presets[0].start.toISOString()).toBe("2026-05-18T00:00:00.000Z"); // project start, day-floored
    expect(presets[0].target.toISOString()).toBe("2026-07-02T00:00:00.000Z"); // today
    expect(presets.map((p) => p.label)).toEqual(["Project", "This month", "Last month", "Quarter", "YTD"]);
  });

  it("omits the Project preset for a future start, a null range or an invalid date", () => {
    expect(buildPresets(NOW, { start: "2026-09-01T00:00:00Z", end: null }).map((p) => p.label)).not.toContain("Project");
    expect(buildPresets(NOW, null).map((p) => p.label)).not.toContain("Project");
    expect(buildPresets(NOW, { start: null, end: null }).map((p) => p.label)).not.toContain("Project");
    expect(buildPresets(NOW, { start: "not-a-date", end: null }).map((p) => p.label)).not.toContain("Project");
  });
});

describe("rangeMatches", () => {
  it("matches only when both bounds equal the preset's", () => {
    const [p] = buildPresets(NOW, { start: "2026-05-18T00:00:00Z", end: null });
    expect(rangeMatches({ start: p.start, target: p.target }, p)).toBe(true);
    expect(rangeMatches({ start: p.start, target: startOfDayUTC(new Date("2026-07-01T00:00:00Z")) }, p)).toBe(false);
    expect(rangeMatches({ start: null, target: p.target }, p)).toBe(false);
  });
});
