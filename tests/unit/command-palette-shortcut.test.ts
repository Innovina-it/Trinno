// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isEditableShortcutTarget,
  isBoardRoute,
  shouldSuppressQuickAddShortcut,
} from "@/lib/command-palette/shortcut-guard";

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

describe("isBoardRoute", () => {
  it("returns true for /b/123", () => {
    expect(isBoardRoute("/b/123")).toBe(true);
  });

  it("returns true for /board/x", () => {
    expect(isBoardRoute("/board/x")).toBe(true);
  });

  it("returns false for /w/abc/roadmap", () => {
    expect(isBoardRoute("/w/abc/roadmap")).toBe(false);
  });

  it("returns false for /inbox", () => {
    expect(isBoardRoute("/inbox")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isBoardRoute(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isBoardRoute(undefined)).toBe(false);
  });
});

describe("shouldSuppressQuickAddShortcut", () => {
  const div = document.createElement("div");
  const input = document.createElement("input");

  it("returns true (suppress) when key is 'c' on a non-board route", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: false, ctrlKey: false, altKey: false, target: div },
        "/w/abc/roadmap",
      ),
    ).toBe(true);
  });

  it("returns true (suppress) when key is 'C' on a non-board route", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "C", metaKey: false, ctrlKey: false, altKey: false, target: div },
        "/inbox",
      ),
    ).toBe(true);
  });

  it("returns false (allow) when key is 'c' on a board route with non-editable target", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: false, ctrlKey: false, altKey: false, target: div },
        "/b/123",
      ),
    ).toBe(false);
  });

  it("returns true (suppress) when key is 'c' on a board route with an editable target (INPUT)", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: false, ctrlKey: false, altKey: false, target: input },
        "/b/123",
      ),
    ).toBe(true);
  });

  it("returns false (allow) when metaKey is held", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: true, ctrlKey: false, altKey: false, target: div },
        "/w/abc/roadmap",
      ),
    ).toBe(false);
  });

  it("returns false (allow) when ctrlKey is held", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: false, ctrlKey: true, altKey: false, target: div },
        "/w/abc/roadmap",
      ),
    ).toBe(false);
  });

  it("returns false (allow) when altKey is held", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "c", metaKey: false, ctrlKey: false, altKey: true, target: div },
        "/w/abc/roadmap",
      ),
    ).toBe(false);
  });

  it("returns false (allow) when key is not 'c' or 'C'", () => {
    expect(
      shouldSuppressQuickAddShortcut(
        { key: "x", metaKey: false, ctrlKey: false, altKey: false, target: div },
        "/w/abc/roadmap",
      ),
    ).toBe(false);
  });
});
