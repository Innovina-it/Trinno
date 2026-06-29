// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEditableShortcutTarget } from "@/lib/command-palette/shortcut-guard";

describe("isEditableShortcutTarget", () => {
  it("returns true for an INPUT element", () => {
    const el = document.createElement("input");
    expect(isEditableShortcutTarget(el)).toBe(true);
  });

  it("returns true for a TEXTAREA element", () => {
    const el = document.createElement("textarea");
    expect(isEditableShortcutTarget(el)).toBe(true);
  });

  it("returns true for a SELECT element", () => {
    const el = document.createElement("select");
    expect(isEditableShortcutTarget(el)).toBe(true);
  });

  it("returns true for a contentEditable element", () => {
    const el = document.createElement("div");
    // jsdom does not fully compute isContentEditable from the attribute;
    // override the getter directly to test the function's branch.
    Object.defineProperty(el, "isContentEditable", { get: () => true });
    expect(isEditableShortcutTarget(el)).toBe(true);
  });

  it("returns false for a plain DIV", () => {
    const el = document.createElement("div");
    expect(isEditableShortcutTarget(el)).toBe(false);
  });

  it("returns false for a SPAN", () => {
    const el = document.createElement("span");
    expect(isEditableShortcutTarget(el)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isEditableShortcutTarget(null)).toBe(false);
  });
});
