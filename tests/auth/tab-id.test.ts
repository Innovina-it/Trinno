// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("lib/auth/tab-id", () => {
  it("generates, caches, and persists a tabId in sessionStorage", async () => {
    const { getTabId, TAB_ID_STORAGE_KEY } = await import("../../lib/auth/tab-id");
    const id1 = getTabId();
    expect(id1).not.toBe("");
    expect(window.sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBe(id1);
    const id2 = getTabId();
    expect(id2).toBe(id1);
  });

  it("returns the existing sessionStorage value on second module load", async () => {
    const first = await import("../../lib/auth/tab-id");
    const firstId = first.getTabId();
    vi.resetModules();
    const second = await import("../../lib/auth/tab-id");
    expect(second.getTabId()).toBe(firstId);
  });

  it("clears cache and storage on resetTabId", async () => {
    const { getTabId, resetTabId, TAB_ID_STORAGE_KEY } = await import(
      "../../lib/auth/tab-id"
    );
    const id1 = getTabId();
    resetTabId();
    expect(window.sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBeNull();
    const id2 = getTabId();
    expect(id2).not.toBe(id1);
  });

  it("returns empty string when window is undefined (SSR)", async () => {
    const realWindow = globalThis.window;
    // Simulate SSR by removing window
    // @ts-expect-error force SSR shape
    delete globalThis.window;
    try {
      vi.resetModules();
      const { getTabId } = await import("../../lib/auth/tab-id");
      expect(getTabId()).toBe("");
    } finally {
      globalThis.window = realWindow;
    }
  });

  it("uses crypto.randomUUID when available", async () => {
    const uuidSpy = vi.fn(() => "stub-uuid-1234");
    vi.stubGlobal("crypto", { randomUUID: uuidSpy });
    const { getTabId } = await import("../../lib/auth/tab-id");
    expect(getTabId()).toBe("stub-uuid-1234");
    expect(uuidSpy).toHaveBeenCalled();
  });
});
