import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseJsMocks = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, opts: unknown) => ({
    url,
    key,
    opts,
  })),
}));

vi.mock("@supabase/supabase-js", () => supabaseJsMocks);

function stubEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function clearEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  vi.resetModules();
  supabaseJsMocks.createClient.mockClear();
  clearEnv();
});

describe("getServiceSupabase", () => {
  it("constructs a service-role client with persistSession disabled", async () => {
    stubEnv();
    const { getServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    const client = getServiceSupabase();

    expect(supabaseJsMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseJsMocks.createClient).toHaveBeenCalledWith(
      "https://project-ref.supabase.co",
      "service-role-key",
      { auth: { persistSession: false } },
    );
    expect(client).toEqual({
      url: "https://project-ref.supabase.co",
      key: "service-role-key",
      opts: { auth: { persistSession: false } },
    });
  });

  it("memoizes — second call returns the cached instance without re-constructing", async () => {
    stubEnv();
    const { getServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    const a = getServiceSupabase();
    const b = getServiceSupabase();

    expect(a).toBe(b);
    expect(supabaseJsMocks.createClient).toHaveBeenCalledTimes(1);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { getServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    expect(() => getServiceSupabase()).toThrow();
    expect(supabaseJsMocks.createClient).not.toHaveBeenCalled();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
    const { getServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    expect(() => getServiceSupabase()).toThrow();
    expect(supabaseJsMocks.createClient).not.toHaveBeenCalled();
  });
});

describe("tryGetServiceSupabase", () => {
  it("returns null when env is not configured (no throw)", async () => {
    const { tryGetServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    expect(tryGetServiceSupabase()).toBeNull();
    expect(supabaseJsMocks.createClient).not.toHaveBeenCalled();
  });

  it("returns the client when env is configured", async () => {
    stubEnv();
    const { tryGetServiceSupabase } = await import(
      "../../lib/supabase/service-role"
    );

    const client = tryGetServiceSupabase();
    expect(client).not.toBeNull();
    expect(supabaseJsMocks.createClient).toHaveBeenCalledTimes(1);
  });

  it("shares the cache with getServiceSupabase", async () => {
    stubEnv();
    const mod = await import("../../lib/supabase/service-role");

    const a = mod.getServiceSupabase();
    const b = mod.tryGetServiceSupabase();

    expect(a).toBe(b);
    expect(supabaseJsMocks.createClient).toHaveBeenCalledTimes(1);
  });
});

describe("client-side bundle safety", () => {
  it("is not imported by any client-tagged module", async () => {
    // Tripwire: any file with "use client" at the top must not import
    // lib/supabase/service-role.ts. The service-role key would then end
    // up in the browser bundle.
    const { execSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    const repoRoot = resolve(__dirname, "../..");

    // Find every file containing 'use client'
    const clientFilesRaw = execSync(
      `grep -rl --include="*.ts" --include="*.tsx" "use client" "${repoRoot}/app" "${repoRoot}/components" "${repoRoot}/lib" 2>/dev/null || true`,
    )
      .toString()
      .trim();

    if (!clientFilesRaw) return;

    const clientFiles = clientFilesRaw.split("\n").filter(Boolean);
    const offenders: string[] = [];

    for (const file of clientFiles) {
      const contents = execSync(`cat "${file}"`).toString();
      if (
        /from\s+["']@\/lib\/supabase\/service-role["']/.test(contents) ||
        /from\s+["'].*lib\/supabase\/service-role["']/.test(contents)
      ) {
        offenders.push(file);
      }
    }

    expect(offenders, `client modules importing service-role:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
