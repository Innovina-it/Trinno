import { describe, it, expect } from "vitest";

import {
  REPORT_SECTION_GROUPS,
  REPORT_SECTION_KEYS,
  REPORT_SECTION_LABELS,
} from "@/lib/pma/report-sections";

// The Run-analysis outline groups must stay in lockstep with the canonical key
// list: flattening the groups in order has to reproduce REPORT_SECTION_KEYS
// exactly (same keys, same order, no dupes, no omissions). A drift here would
// silently drop a section from the UI or render it out of report order.
describe("REPORT_SECTION_GROUPS", () => {
  const flattened = REPORT_SECTION_GROUPS.flatMap((g) => g.keys);

  it("flattens to REPORT_SECTION_KEYS in the same order", () => {
    expect(flattened).toEqual([...REPORT_SECTION_KEYS]);
  });

  it("covers every key exactly once", () => {
    expect(new Set(flattened).size).toBe(REPORT_SECTION_KEYS.length);
    for (const key of REPORT_SECTION_KEYS) {
      expect(flattened).toContain(key);
    }
  });

  it("labels every grouped key", () => {
    for (const key of flattened) {
      expect(REPORT_SECTION_LABELS[key]).toBeTruthy();
    }
  });
});
