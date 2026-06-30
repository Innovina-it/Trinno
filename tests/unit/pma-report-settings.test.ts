import { describe, it, expect } from "vitest";
import {
  sanitizeReportLength,
  sanitizeCustomPrompt,
  lengthDirective,
  customFocusDirective,
  MAX_CUSTOM_PROMPT_CHARS,
} from "@/lib/pma/report-settings";

describe("sanitizeReportLength", () => {
  it("passes through the three valid lengths", () => {
    expect(sanitizeReportLength("short")).toBe("short");
    expect(sanitizeReportLength("medium")).toBe("medium");
    expect(sanitizeReportLength("long")).toBe("long");
  });
  it("defaults anything else to medium", () => {
    expect(sanitizeReportLength(undefined)).toBe("medium");
    expect(sanitizeReportLength(null)).toBe("medium");
    expect(sanitizeReportLength("LONG")).toBe("medium"); // case-sensitive
    expect(sanitizeReportLength(42)).toBe("medium");
  });
});

describe("sanitizeCustomPrompt", () => {
  it("trims and returns text, null for empty/non-string", () => {
    expect(sanitizeCustomPrompt("  focus on spine  ")).toBe("focus on spine");
    expect(sanitizeCustomPrompt("   ")).toBeNull();
    expect(sanitizeCustomPrompt("")).toBeNull();
    expect(sanitizeCustomPrompt(123)).toBeNull();
    expect(sanitizeCustomPrompt(null)).toBeNull();
  });
  it("caps at MAX_CUSTOM_PROMPT_CHARS", () => {
    const long = "x".repeat(MAX_CUSTOM_PROMPT_CHARS + 500);
    expect(sanitizeCustomPrompt(long)!.length).toBe(MAX_CUSTOM_PROMPT_CHARS);
  });
});

describe("lengthDirective", () => {
  it("medium → empty (byte-identical to the default)", () => {
    expect(lengthDirective("medium")).toBe("");
  });
  it("short and long emit a directive", () => {
    expect(lengthDirective("short")).toContain("SHORT");
    expect(lengthDirective("long")).toContain("LONG");
  });
});

describe("customFocusDirective", () => {
  it("empty → no directive", () => {
    expect(customFocusDirective(null)).toBe("");
    expect(customFocusDirective("   ")).toBe("");
  });
  it("wraps the focus and includes the emphasis-only guard", () => {
    const d = customFocusDirective("focus on spine keypoints");
    expect(d).toContain("ADDITIONAL FOCUS");
    expect(d).toContain("focus on spine keypoints");
    expect(d).toContain("EMPHASIS"); // can't override grounding
    expect(d).toContain("must NOT override");
  });
});
