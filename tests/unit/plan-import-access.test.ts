import { describe, it, expect, vi } from "vitest";

// access.ts carries `import "server-only"`. Stub it so the pure predicate can be
// imported in vitest.
vi.mock("server-only", () => ({}));

import { isImportPlanAllowed } from "@/lib/plan-import/access";

describe("isImportPlanAllowed", () => {
  it("allows the two allowlisted emails", () => {
    expect(isImportPlanAllowed("team@innovina.it")).toBe(true);
    expect(isImportPlanAllowed("paolo.pavani@innovina.it")).toBe(true);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isImportPlanAllowed("Team@Innovina.IT")).toBe(true);
    expect(isImportPlanAllowed("  paolo.pavani@innovina.it  ")).toBe(true);
  });

  it("rejects any other email and empty/missing values", () => {
    expect(isImportPlanAllowed("someone.else@innovina.it")).toBe(false);
    expect(isImportPlanAllowed("attacker@evil.com")).toBe(false);
    expect(isImportPlanAllowed("")).toBe(false);
    expect(isImportPlanAllowed(null)).toBe(false);
    expect(isImportPlanAllowed(undefined)).toBe(false);
  });
});
