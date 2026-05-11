// E2E: bulk "Mark complete" via the BulkActionBar.
//
// Covers Plan #16b-γ-D (#8) bulk-action-bar surface for the completion
// flow specifically: select N tiles → click "Mark complete" → tiles
// repaint with line-through + lime ring (`data-completed="true"` on
// `[data-testid="tile-title"]`), bar collapses (selection clears), undo
// banner surfaces.
//
// Per-file helpers (no shared fixtures) — matches the existing pattern
// in this repo's tests/e2e directory. See tests/e2e/lists-cards-dnd.spec.ts.
//
// SETUP NOTES (post Plan #16b post-rebrand):
//   * Local dev has email confirmation OFF (supabase/config.toml ->
//     enable_confirmations = false), so signup yields a session
//     immediately.
//   * Setting cookie `tr_seed_demo=1` makes the auth callback run the
//     RICH demo seed (creates "Product OKRs" + "Bug triage" + "Daily
//     standup" boards with dated cards).  We navigate to "Product OKRs"
//     where the "This sprint"/"In progress" lists each carry several
//     non-completed stories.
//   * The bulk-mark-complete button is `[data-testid="bulk-action-complete"]`.
//   * The selection handle on each tile is `[data-testid="tile-select-handle"]`.
//   * The completed-state attribute the tile renders is on
//     `[data-testid="tile-title"]` -> `data-completed="true|false"`.

import { test, expect, type Page } from "@playwright/test";

async function signupAndSeed(page: Page, prefix: string): Promise<{ workspaceId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  // "1" -> rich seed (boards + dated cards + sprints).
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
  const workspaceId = page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
  return { workspaceId };
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

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: /skip/i }).click().catch(() => {});
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function openProductOkrsBoard(page: Page, workspaceId: string) {
  // The seed creates "Product OKRs" — go to the boards index then click it.
  await safeGoto(page, `/w/${workspaceId}/boards`);
  await dismissTourIfPresent(page);
  const boardLink = page.locator('a[href^="/b/"]').filter({ hasText: /Product OKRs/i }).first();
  await expect(boardLink).toBeVisible({ timeout: 10_000 });
  await boardLink.click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/, { timeout: 15_000 });
  // Wait for at least 3 tiles to render before we try to select.
  await expect.poll(
    async () => await page.locator('[data-card-id]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(3);
}

test("bulk mark-complete: selection -> bulk-action-complete -> tiles flip + undo banner", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndSeed(page, "cb");
  await openProductOkrsBoard(page, workspaceId);

  // Pick 3 NOT-yet-completed tiles. The seed marks some Sprint-14 closed
  // stories complete; we filter by data-completed="false" on tile-title.
  const incompleteTiles = page.locator(
    '[data-card-id]:has([data-testid="tile-title"][data-completed="false"])',
  );
  await expect.poll(
    async () => await incompleteTiles.count(),
    { timeout: 10_000 },
  ).toBeGreaterThanOrEqual(3);

  const targetIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const tile = incompleteTiles.nth(i);
    const id = await tile.getAttribute("data-card-id");
    if (!id) throw new Error(`tile ${i} missing data-card-id`);
    targetIds.push(id);
    // The select-handle is opacity-0 until hover; force hover then click.
    await tile.hover();
    await tile.getByTestId("tile-select-handle").click();
    await expect(tile).toHaveAttribute("data-selected", "true");
  }

  // Bulk action bar is now visible with count = 3.
  const bar = page.getByTestId("bulk-action-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("bulk-action-bar-count")).toHaveText(/3 SELECTED/);

  // Click "Mark complete".
  await page.getByTestId("bulk-action-complete").click();

  // Each selected tile's title repaints with data-completed="true".
  for (const id of targetIds) {
    const title = page
      .locator(`[data-card-id="${id}"] [data-testid="tile-title"]`)
      .first();
    await expect(title).toHaveAttribute("data-completed", "true", { timeout: 8000 });
  }

  // Selection is cleared on success -> bulk action bar collapses (component
  // returns null when count === 0).
  await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0, { timeout: 8000 });

  // Undo banner surfaced "Completed N cards".
  const undo = page.getByTestId("undo-banner");
  await expect(undo).toBeVisible({ timeout: 5000 });
  await expect(undo).toContainText(/Completed 3 cards?/i);
});
