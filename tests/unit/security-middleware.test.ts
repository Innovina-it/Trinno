import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser },
  })),
}));

function makeRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.test${path}`, { headers });
}

describe("security baseline middleware", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("returns 401 JSON for unauthenticated internal API requests", async () => {
    const { middleware } = await import("@/middleware");

    const res = await middleware(
      makeRequest("/api/internal/health", { accept: "application/json" }),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("redirects unauthenticated dashboard HTML requests to login with next", async () => {
    const { middleware } = await import("@/middleware");

    const res = await middleware(
      makeRequest("/dashboard", { accept: "text/html" }),
    );
    const location = new URL(res.headers.get("location")!);

    expect(res.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("keeps the matcher broad enough for dashboard and internal API routes", async () => {
    const { config } = await import("@/middleware");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(config.matcher).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/_next\/static/),
      ]),
    );
    expect("/dashboard").toMatch(matcher);
    expect("/api/internal/health").toMatch(matcher);
  });
});
