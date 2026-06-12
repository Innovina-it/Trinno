// E2E: "Hide completed" filter chip on the board view.
//
// Covers Plan #16b-γ-D filter chip in components/board/board-filter-bar.tsx.
// The chip's testid is `board-hide-completed-toggle` (NOT
// `filter-hide-completed`; existing testid was kept rather than added
// fresh — see filter-bar source). URL key is `done=hide` to match the
// workload page's convention (see lib/board-filters.ts).
//
// Flow:
//   1. signup with rich seed.
//   2. open the "Product OKRs" board.
//   3. mark exactly one card complete via the tile's CompleteToggle
//      (`[data-testid="complete-toggle"]`).
//   4. toggle the hide-completed chip ON.
//      - URL gains `?done=hide`.
//      - The completed tile is no longer in the DOM.
//   5. toggle it OFF.
//      - URL drops `done=hide`.
//      - The completed tile reappears.

import { test, expect, type Page } from "@playwright/test";

async function signupAndSeed(page: Page, prefix: string): Promise<{ workspaceId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "1", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  // Rich seed builds 3 boards + 4 sprints + many cards on cold runners —
  // give the redirect a generous window before declaring failure.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return { workspaceId: page.url().match(/\/w\/([0-9a-f-]{36})/)![1] };
}

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: /skip/i }).click().catch(() => {});
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function safeGoto(page: Page, url: string) {
  // Same pattern as gantt-drag-first.spec.ts — workspace redirects can race
  // with subsequent navigations on cold runners.
  try {
    await page.goto(url);
  } catch {
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

async function openProductOkrsBoard(page: Page, workspaceId: string) {
  await safeGoto(page, `/w/${workspaceId}/boards`);
  await dismissTourIfPresent(page);
  const boardLink = page.locator('a[href^="/b/"]').filter({ hasText: /Product OKRs/i }).first();
  await expect(boardLink).toBeVisible({ timeout: 10_000 });
  await boardLink.click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect.poll(
    async () => await page.locator('[data-card-id]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(1);
}

test("hide-completed filter: toggles ?done=hide + filters tile in/out", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndSeed(page, "cf");
  await openProductOkrsBoard(page, workspaceId);

  // Pick the first not-yet-completed tile and mark it complete via the
  // inline CompleteToggle (the small lime ring next to the title).
  const incompleteTile = page.locator(
    '[data-card-id]:has([data-testid="tile-title"][data-completed="false"])',
  ).first();
  await expect(incompleteTile).toBeVisible({ timeout: 10_000 });
  const targetId = await incompleteTile.getAttribute("data-card-id");
  if (!targetId) throw new Error("missing data-card-id on target tile");

  await incompleteTile.hover();
  await incompleteTile.getByTestId("complete-toggle").click();

  // Tile now shows as completed.
  const tileTitle = page
    .locator(`[data-card-id="${targetId}"] [data-testid="tile-title"]`)
    .first();
  await expect(tileTitle).toHaveAttribute("data-completed", "true", { timeout: 8000 });

  // Toggle hide-completed ON.
  const chip = page.getByTestId("board-hide-completed-toggle");
  await expect(chip).toBeVisible();
  await chip.click();

  // URL gains ?done=hide.
  await expect(page).toHaveURL(/[?&]done=hide(?:&|$)/, { timeout: 5000 });
  // Chip flipped to "active".
  await expect(chip).toHaveAttribute("data-active", "true");

  // Completed tile is removed from the DOM.
  await expect(page.locator(`[data-card-id="${targetId}"]`)).toHaveCount(0, {
    timeout: 5000,
  });

  // Toggle back OFF.
  await chip.click();
  await expect(chip).toHaveAttribute("data-active", "false");
  // URL no longer has done=hide.
  await expect(page).not.toHaveURL(/[?&]done=hide(?:&|$)/, { timeout: 5000 });
  // Tile reappears.
  await expect(page.locator(`[data-card-id="${targetId}"]`)).toHaveCount(1, {
    timeout: 5000,
  });
});
