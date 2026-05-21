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

async function load() {
  return await import("../../lib/http/fetch-with-tab-id");
}

describe("lib/http/fetch-with-tab-id", () => {
  it("adds x-tab-id header on same-origin string url", async () => {
    const { fetchWithTabId } = await load();
    const originalFetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    await fetchWithTabId(originalFetch, "/api/foo");
    const init = originalFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init).toBeDefined();
    const headers = new Headers(init.headers);
    expect(headers.get("x-tab-id")).not.toBeNull();
    expect(headers.get("x-tab-id")?.length ?? 0).toBeGreaterThan(0);
  });

  it("preserves caller-provided headers", async () => {
    const { fetchWithTabId } = await load();
    const originalFetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    await fetchWithTabId(originalFetch, "/api/foo", {
      headers: { "x-custom": "v", "x-tab-id": "preset-id" },
    });
    const init = originalFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-custom")).toBe("v");
    expect(headers.get("x-tab-id")).toBe("preset-id");
  });

  it("does not modify cross-origin requests", async () => {
    const { fetchWithTabId } = await load();
    const originalFetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    await fetchWithTabId(originalFetch, "https://other.example/api");
    const init = originalFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    if (init?.headers) {
      const headers = new Headers(init.headers);
      expect(headers.get("x-tab-id")).toBeNull();
    } else {
      expect(init?.headers).toBeUndefined();
    }
  });

  it("respects NEXT_PUBLIC_TAB_ID_HEADER=false kill switch", async () => {
    const previous = process.env.NEXT_PUBLIC_TAB_ID_HEADER;
    process.env.NEXT_PUBLIC_TAB_ID_HEADER = "false";
    try {
      vi.resetModules();
      const { fetchWithTabId } = await load();
      const originalFetch = vi.fn<typeof fetch>(async () => new Response("ok"));
      await fetchWithTabId(originalFetch, "/api/foo");
      const init = originalFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      if (init?.headers) {
        const headers = new Headers(init.headers);
        expect(headers.get("x-tab-id")).toBeNull();
      }
    } finally {
      process.env.NEXT_PUBLIC_TAB_ID_HEADER = previous;
    }
  });

  it("installTabIdInterceptor wraps window.fetch idempotently", async () => {
    const { installTabIdInterceptor } = await load();
    const originalFetch = window.fetch;
    installTabIdInterceptor();
    const wrappedOnce = window.fetch;
    expect(wrappedOnce).not.toBe(originalFetch);
    installTabIdInterceptor();
    expect(window.fetch).toBe(wrappedOnce);
  });
});
