import { describe, expect, it } from "vitest";
import {
  formatFailedSteps,
  readSeedReportCookie,
} from "@/components/seed-failure-banner";

/**
 * Plan errors-onboarding (U4) — pure-function coverage for the
 * SeedFailureBanner pipeline. The DOM-rendering side (mounting the
 * component) is exercised in production via app/(app)/layout.tsx;
 * the unit-level tests focus on the cookie parsing + the copy
 * formatter so the banner's bus-push payload stays correct.
 */

describe("readSeedReportCookie", () => {
  it("returns null when cookie is absent", () => {
    expect(readSeedReportCookie("other=value")).toBeNull();
  });

  it("returns null when JSON is malformed", () => {
    expect(readSeedReportCookie("tr_seed_report=not-json")).toBeNull();
  });

  it("returns null when failedSteps is missing or not an array", () => {
    expect(
      readSeedReportCookie(`tr_seed_report=${encodeURIComponent("{}")}`),
    ).toBeNull();
    expect(
      readSeedReportCookie(
        `tr_seed_report=${encodeURIComponent('{"failedSteps":42}')}`,
      ),
    ).toBeNull();
  });

  it("returns null when failedSteps is empty", () => {
    expect(
      readSeedReportCookie(
        `tr_seed_report=${encodeURIComponent('{"failedSteps":[]}')}`,
      ),
    ).toBeNull();
  });

  it("parses a well-formed cookie into a string[]", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ failedSteps: ["comments", "watchers"] }),
    );
    expect(readSeedReportCookie(`tr_seed_report=${raw}`)).toEqual([
      "comments",
      "watchers",
    ]);
  });

  it("strips non-string entries", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ failedSteps: ["ok", 42, null, "also-ok"] }),
    );
    expect(readSeedReportCookie(`tr_seed_report=${raw}`)).toEqual([
      "ok",
      "also-ok",
    ]);
  });

  it("ignores adjacent cookies in the jar", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ failedSteps: ["x"] }),
    );
    expect(
      readSeedReportCookie(
        `unrelated=foo; tr_seed_report=${raw}; another=bar`,
      ),
    ).toEqual(["x"]);
  });
});

describe("formatFailedSteps", () => {
  it("joins ≤4 steps with commas", () => {
    expect(formatFailedSteps(["a", "b"])).toBe("Steps that failed: a, b");
    expect(formatFailedSteps(["a", "b", "c", "d"])).toBe(
      "Steps that failed: a, b, c, d",
    );
  });

  it("truncates >4 steps with a (+N more) suffix", () => {
    expect(formatFailedSteps(["a", "b", "c", "d", "e", "f"])).toBe(
      "Steps that failed: a, b, c, d (+2 more)",
    );
  });
});
