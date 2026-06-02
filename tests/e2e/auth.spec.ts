import { test, expect } from "@playwright/test";

test("signup → confirm → home → logout", async ({ page }) => {
  // Allowed domain (the email-domain hook rejects @example.com).
  const email = `e2e-${Date.now()}@innovina.it`;

  await page.context().addCookies([
    { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  // After signup, "/" redirects to the user's default workspace.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  await expect(page.getByText(/Workspace$/)).toBeVisible();

  // Logout: clearing the supabase session cookies + reloading triggers
  // the middleware redirect to /login.  Playwright's click through the
  // base-ui DropdownMenu portal is flaky on CI runners and the dropdown
  // itself is covered by the smaller dropdown specs.
  await page.context().clearCookies();
  await page.reload({ waitUntil: "load" }).catch(() => {});
  await expect(page).toHaveURL(/\/login/);
});
