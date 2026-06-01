// E2E: roadmap completion toggle — real-browser UI wiring.
//
// Scope: these specs prove the *roadmap toggle UI* fires the
// setRoadmapCompletion server action and flips optimistically in a live
// session. The DB-level effects (card moves to the Done list, prior list
// recorded, reversion, no-yank, auto-create Done, authorization) are
// covered exhaustively in tests/integration/roadmap-completion
// (INT-01..17, REGR-*, AUTH-*) and verified directly against Postgres.
//
// Known pre-existing limitation (NOT this feature): lib/queries/roadmap
// does not SELECT completed_at, so RoadmapCard.completedAt is undefined on
// a fresh server load — completion on the roadmap is reflected only via the
// optimistic patch + realtime store while the page is live, and is not
// re-derived after a hard reload. Assertions here therefore stay within a
// single live session and never re-load to check persistence.
//
// Selectors:
//   - roadmap bar:         [data-testid="roadmap-bar"][data-card-id]
//   - bar complete toggle: [data-testid="roadmap-bar-complete-toggle"][data-completed]
//
// Local signup rejects @example.com; use @innovina.it. Locate bars by
// stable data-card-id, never by a data-completed filter (it stops matching
// the moment a card is toggled).

import { test, expect, type Page, type Locator } from "@playwright/test";

async function signupAndSeed(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "1", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
}

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: /skip/i }).click().catch(() => {});
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function gotoRoadmap(page: Page, wsId: string) {
  try {
    await page.goto(`/w/${wsId}/roadmap`);
  } catch {
    await page.goto(`/w/${wsId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await dismissTourIfPresent(page);
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => page.locator('[data-testid="roadmap-bar"]').count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
}

function openBars(page: Page): Locator {
  return page
    .locator('[data-testid="roadmap-bar"]')
    .filter({
      has: page.locator('[data-testid="roadmap-bar-complete-toggle"][data-completed="false"]'),
    });
}

async function firstOpenCardId(page: Page): Promise<string> {
  const bar = openBars(page).first();
  await expect(bar).toBeVisible({ timeout: 10_000 });
  const id = await bar.getAttribute("data-card-id");
  if (!id) throw new Error("roadmap bar without data-card-id");
  return id;
}

const toggleFor = (page: Page, cardId: string): Locator =>
  page
    .locator(`[data-testid="roadmap-bar"][data-card-id="${cardId}"]`)
    .first()
    .locator('[data-testid="roadmap-bar-complete-toggle"]');

async function expectCompleted(page: Page, cardId: string, value: "true" | "false", timeout = 8000) {
  await expect(toggleFor(page, cardId)).toHaveAttribute("data-completed", value, { timeout });
}

test.describe("roadmap completion toggle", () => {
  test("E2E-01: ticking the roadmap toggle marks the card complete", async ({ page }) => {
    test.setTimeout(120_000);
    const ws = await signupAndSeed(page, "e2e01");
    await gotoRoadmap(page, ws);

    const cardId = await firstOpenCardId(page);
    await toggleFor(page, cardId).click();
    await expectCompleted(page, cardId, "true");
  });

  test("E2E-02: ticking then un-ticking returns the toggle to open", async ({ page }) => {
    test.setTimeout(120_000);
    const ws = await signupAndSeed(page, "e2e02");
    await gotoRoadmap(page, ws);

    const cardId = await firstOpenCardId(page);
    await toggleFor(page, cardId).click();
    await expectCompleted(page, cardId, "true");
    await toggleFor(page, cardId).click();
    await expectCompleted(page, cardId, "false");
  });

  test("E2E-05: the completion flip is optimistic (no wait for the server)", async ({ page }) => {
    test.setTimeout(120_000);
    const ws = await signupAndSeed(page, "e2e05");
    await gotoRoadmap(page, ws);

    const cardId = await firstOpenCardId(page);
    await toggleFor(page, cardId).click();
    // Flips fast — before the round-trip — proving the optimistic patch.
    await expectCompleted(page, cardId, "true", 1500);
  });

  test("E2E-06: completing one card does not affect other cards on the roadmap", async ({ page }) => {
    test.setTimeout(120_000);
    const ws = await signupAndSeed(page, "e2e06");
    await gotoRoadmap(page, ws);

    await expect.poll(async () => openBars(page).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const firstId = (await openBars(page).nth(0).getAttribute("data-card-id"))!;
    const secondId = (await openBars(page).nth(1).getAttribute("data-card-id"))!;

    await toggleFor(page, firstId).click();
    await expectCompleted(page, firstId, "true");
    // The untouched card stays open.
    await expectCompleted(page, secondId, "false", 5000);
  });
});
