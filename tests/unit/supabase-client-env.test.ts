import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrMocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn((url: string, key: string) => ({
    key,
    type: "browser",
    url,
  })),
  createServerClient: vi.fn((url: string, key: string) => ({
    key,
    type: "server",
    url,
  })),
}));

vi.mock("@supabase/ssr", () => ssrMocks);

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

function stubSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_DB_URL =
    "postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:6543/postgres";
  process.env.SUPABASE_DB_DIRECT_URL =
    "postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres";
}

beforeEach(() => {
  vi.resetModules();
  ssrMocks.createBrowserClient.mockClear();
  ssrMocks.createServerClient.mockClear();
  stubSupabaseEnv();
});

describe("Supabase client env wiring", () => {
  it("initializes the cookie-based server client and browser client", async () => {
    const { createSupabaseServer } = await import("../../lib/supabase/server");
    const { createSupabaseBrowser } = await import("../../lib/supabase/browser");

    await expect(createSupabaseServer()).resolves.toEqual({
      key: "anon-key",
      type: "server",
      url: "https://project-ref.supabase.co",
    });
    expect(() => createSupabaseBrowser()).not.toThrow();
  });

  it("does not pass the service role key to the browser client", async () => {
    const { createSupabaseBrowser } = await import("../../lib/supabase/browser");

    createSupabaseBrowser();

    expect(ssrMocks.createBrowserClient).toHaveBeenCalledWith(
      "https://project-ref.supabase.co",
      "anon-key",
    );
    expect(ssrMocks.createBrowserClient.mock.calls.flat()).not.toContain(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  });
});
