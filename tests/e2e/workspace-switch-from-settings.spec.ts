import { test, expect, type Page } from "@playwright/test";

// Test bed for the fix: switching workspaces from the Manage-workspace
// (settings) page should drop INTO the chosen workspace's roadmap, not
// pin you to the new workspace's settings page.

async function signupAndLand(page: Page, email: string) {
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

function workspaceIdFromUrl(page: Page): string {
  const m = page.url().match(/\/w\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`no workspace id in url: ${page.url()}`);
  return m[1];
}

test("switch from settings lands on the new workspace's roadmap", async ({
  page,
}) => {
  // Signup is restricted to the internal domain by the before_user_created
  // allowlist hook (migration 0056), so the fixture must use @innovina.it.
  const email = `switch-${Date.now()}@innovina.it`;
  await signupAndLand(page, email);
  // Minimal seed creates "Test Workspace" — capture its id (workspace A).
  const wsA = workspaceIdFromUrl(page);

  // Create a second workspace (B) so there is somewhere to switch to.
  await page.getByTestId("workspace-switcher-trigger").click();
  await page.getByTestId("workspace-switcher-new").click();
  await page.getByLabel("Name").fill("Switch Target");
  await page.getByRole("button", { name: /^create$/i }).click();
  // Wait for the create to navigate INTO the new workspace (a different id),
  // not just any /w/ URL — otherwise we'd capture the old id before the push.
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/w\/([0-9a-f-]{36})/);
    return !!m && m[1] !== wsA;
  });
  const wsB = workspaceIdFromUrl(page);
  expect(wsB).not.toBe(wsA);

  // Land on workspace B's settings page (the "Manage workspace" view).
  await page.goto(`/w/${wsB}/settings`);
  await expect(page).toHaveURL(`/w/${wsB}/settings`);

  // THE FIX: from B's settings, pick workspace A → land on A's roadmap,
  // NOT A's settings.
  await page.getByTestId("workspace-switcher-trigger").click();
  await page.getByRole("menuitem", { name: "Test Workspace" }).click();
  await expect(page).toHaveURL(`/w/${wsA}/roadmap`);

  // MUST-NOT-CHANGE: from a non-settings subsection (roadmap), switching
  // still preserves that subsection. Pick B → land on B's roadmap.
  await page.getByTestId("workspace-switcher-trigger").click();
  await page.getByRole("menuitem", { name: "Switch Target" }).click();
  await expect(page).toHaveURL(`/w/${wsB}/roadmap`);
});
