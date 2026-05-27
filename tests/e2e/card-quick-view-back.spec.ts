import { test, expect, type Page } from "@playwright/test";

// The card quick-view (double-click / single-click a card) is a Dialog
// overlay floating over the board or roadmap it was opened from. A top-right
// "Back" control dismisses it and returns to that surface (the "previous
// page"). Because the qv defers edits to a Save/Discard confirm phase, the
// back control must route through the same dirty-guard as Esc / outside-click
// rather than silently dropping unsaved edits.

async function signupSeeded(page: Page) {
  // Local signup rejects example.com; use @innovina.it. Seed checkbox stays
  // checked so the callback creates a workspace with demo boards + cards.
  const email = `qvb-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}\/roadmap/, { timeout: 20_000 });
}

async function openQuickView(page: Page) {
  await page.waitForTimeout(1200);
  await page.locator("[data-card-id]").first().click();
  await expect(page.getByTestId("card-quick-view")).toBeVisible();
  await expect(page.getByTestId("card-quick-view-back")).toBeVisible();
}

test("quick-view Back control dismisses the dialog and returns to the roadmap", async ({
  page,
}) => {
  await signupSeeded(page);
  await openQuickView(page);

  await page.getByTestId("card-quick-view-back").click();

  // Dialog gone, still on the roadmap we opened it from.
  await expect(page.getByTestId("card-quick-view")).toHaveCount(0);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/roadmap/);
});

test("Back with unsaved edits funnels into the Save-changes confirm phase", async ({
  page,
}) => {
  await signupSeeded(page);
  await openQuickView(page);

  // Make the body dirty: flip completion status (no typing needed).
  await page.getByTestId("card-quick-view-completion").click();

  await page.getByTestId("card-quick-view-back").click();

  // Must NOT silently close — the dirty guard shows the confirm prompt.
  await expect(page.getByTestId("card-quick-view-confirm-prompt")).toBeVisible();
  await expect(page.getByTestId("card-quick-view")).toBeVisible();
});
