import { test, expect, request } from "@playwright/test";

// Tripwire for the auth boundary in lib/supabase/middleware.ts.
// Covers: unauth pages → /login redirect, unauth APIs → 401 JSON,
// cron path bypass, public path pass-through, /login self-serve.

test.describe("middleware auth gate", () => {
  test("unauth board page → redirect to /login with next=", async ({ page }) => {
    await page.context().clearCookies();
    const target = "/b/00000000-0000-0000-0000-000000000000";
    const response = await page.goto(target, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(500);
    expect(page.url()).toMatch(/\/login\?next=%2Fb%2F[0-9a-f-]{36}/);
  });

  test("unauth API → 401 JSON, no redirect", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    });
    const res = await ctx.get("/api/notifications/recent", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body).toMatchObject({ error: expect.stringMatching(/auth/i) });
    await ctx.dispose();
  });

  test("cron path bypasses middleware (handler does Bearer check)", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    });
    // Cron route is GET-only (Vercel cron sends GET with Bearer).
    // Invariant: middleware must let the request reach the handler.
    // Middleware's unauth API response is exactly:
    //   status 401, body { "error": "Authentication required" }
    // Any other status, OR any other body shape at 401, proves bypass worked.
    // (The handler returns 401 "Unauthorized" with proper CRON_SECRET set,
    // 500 "CRON_SECRET not configured" in dev — both prove bypass.)
    const res = await ctx.get("/api/cron/send-emails", {
      maxRedirects: 0,
    });
    const body = await res.json().catch(() => ({}));
    const isMiddlewareBlock =
      res.status() === 401 && body?.error === "Authentication required";
    expect(isMiddlewareBlock).toBe(false);
    await ctx.dispose();
  });

  test("/login renders for logged-out visitors", async ({ page }) => {
    await page.context().clearCookies();
    const res = await page.goto("/login", { waitUntil: "load" });
    expect(res?.status()).toBe(200);
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("/auth/callback reachable without session (OAuth/email-link exchange)", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    });
    // The callback handler ITSELF redirects to /login when there's no
    // session and no PKCE code. That's expected handler behavior. What
    // we're testing here is that *middleware* didn't intercept first.
    // Middleware's redirect always sets `?next=<original>`; the handler's
    // doesn't. So presence of `next=` in the Location is the middleware
    // fingerprint we must NOT see.
    const res = await ctx.get("/auth/callback", { maxRedirects: 0 });
    const location = res.headers()["location"] ?? "";
    expect(location).not.toMatch(/\/login\?.*next=/);
    await ctx.dispose();
  });
});
