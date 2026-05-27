import { test, expect, type Page } from "@playwright/test";

// Opening a card's "advanced settings" from the roadmap lands on the
// full-page card route (the board @modal intercept can't reach across the
// /w roadmap subtree). That full page floats the card on the dark page
// background; clicking that surrounding area must dismiss the card and
// return to the roadmap — matching the board overlay's click-outside-close.

async function signupSeeded(page: Page) {
  // Local signup rejects example.com; use @innovina.it. Seed checkbox stays
  // checked so the callback creates a workspace with demo boards + cards.
  const email = `rc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}\/roadmap/, { timeout: 20_000 });
}

async function openAdvancedFromRoadmap(page: Page) {
  await page.locator("[data-card-id]").first().click();
  await expect(page.getByTestId("card-quick-view")).toBeVisible();
  await page.getByTestId("card-quick-view-open-advanced").click();
  await page.waitForURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}/, { timeout: 15_000 });
  // Full-page card view (not an overlay dialog): the "← BOARD" link is its tell.
  await expect(page.getByRole("link", { name: /BOARD/ })).toBeVisible();
}

test("roadmap full-page card closes when clicking the surrounding area", async ({ page }) => {
  await signupSeeded(page);
  await page.waitForTimeout(1200);
  await openAdvancedFromRoadmap(page);

  // Goal: click the dark margin (far left, well outside the centered card).
  await page.mouse.click(8, 400);
  await page.waitForURL(/\/w\/[0-9a-f-]{36}\/roadmap/, { timeout: 10_000 });
});

test("clicking the card content does NOT close the full-page card", async ({ page }) => {
  await signupSeeded(page);
  await page.waitForTimeout(1200);
  await openAdvancedFromRoadmap(page);

  // Click inside the card body (the CARD · # header text). Must stay open.
  await page.getByText(/^CARD · #/).click();
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}/);
  await expect(page.getByRole("link", { name: /BOARD/ })).toBeVisible();
});

test("board overlay card still closes on backdrop click (unchanged)", async ({ page }) => {
  await signupSeeded(page);
  // Enter a board client-side so the @modal intercept renders the overlay.
  await page.getByTestId("nav-boards").click();
  await page.waitForURL(/\/boards/, { timeout: 10_000 });
  await page.waitForTimeout(1200);
  await page.locator("[data-board-id]").first().click();
  await page.waitForURL(/\/b\/[0-9a-f-]{36}$/, { timeout: 10_000 });
  await page.waitForTimeout(1200);

  await page.locator("[data-card-id]").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);
});
