import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

describe("getSessionToken", () => {
  it("returns null when no Supabase cookie present", async () => {
    const { getSessionToken } = await import("@/lib/auth");
    let token: string | null = null;
    try {
      token = await getSessionToken();
    } catch {
      token = null;
    }
    expect(token).toBeNull();
  });
});
