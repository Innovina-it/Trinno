// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { classifyUndoHotkey } from "@/lib/undo-hotkeys";

type Ev = Parameters<typeof classifyUndoHotkey>[0];

function ev(over: Partial<Ev>): Ev {
  return {
    key: "z",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...over,
  };
}

describe("classifyUndoHotkey (Unit A2)", () => {
  it("Ctrl+Z and Cmd+Z → undo", () => {
    expect(classifyUndoHotkey(ev({ ctrlKey: true }))).toBe("undo");
    expect(classifyUndoHotkey(ev({ metaKey: true }))).toBe("undo");
  });

  it("Ctrl+Shift+Z and Cmd+Shift+Z → redo (capital Z too)", () => {
    expect(classifyUndoHotkey(ev({ ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(
      classifyUndoHotkey(ev({ metaKey: true, shiftKey: true, key: "Z" })),
    ).toBe("redo");
  });

  it("plain z (roadmap zoom) and other keys → null", () => {
    expect(classifyUndoHotkey(ev({}))).toBeNull();
    expect(classifyUndoHotkey(ev({ ctrlKey: true, key: "y" }))).toBeNull();
  });

  it("Alt chords → null", () => {
    expect(classifyUndoHotkey(ev({ ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("typing targets → null (native text undo wins)", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag);
      expect(classifyUndoHotkey(ev({ ctrlKey: true, target: el }))).toBeNull();
    }
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(classifyUndoHotkey(ev({ ctrlKey: true, target: div }))).toBeNull();
  });

  it("non-typing element targets still classify", () => {
    const button = document.createElement("button");
    expect(classifyUndoHotkey(ev({ ctrlKey: true, target: button }))).toBe(
      "undo",
    );
  });
});
