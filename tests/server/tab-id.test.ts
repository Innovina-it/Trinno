import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("lib/server/tab-id", () => {
  it("returns the x-tab-id header when present", async () => {
    vi.doMock("next/headers", () => ({
      headers: async () =>
        new Headers({ "x-tab-id": "uuid-from-client" }),
    }));
    const { getServerTabId } = await import("../../lib/server/tab-id");
    expect(await getServerTabId()).toBe("uuid-from-client");
  });

  it("returns undefined when header is absent", async () => {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers(),
    }));
    const { getServerTabId } = await import("../../lib/server/tab-id");
    expect(await getServerTabId()).toBeUndefined();
  });

  it("returns undefined when headers() throws", async () => {
    vi.doMock("next/headers", () => ({
      headers: async () => {
        throw new Error("not in request scope");
      },
    }));
    const { getServerTabId } = await import("../../lib/server/tab-id");
    expect(await getServerTabId()).toBeUndefined();
  });
});
