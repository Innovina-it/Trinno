import { test, expect, type Page } from "@playwright/test";

// card-edit-concurrency — quick-view (tile popup, batched Save) path.
// Reproduces exactly what the user tested by hand: two windows, edit the
// title in each card popup, Save A then Save B.

async function signup(page: Page) {
  const email = `qvc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page
    .context()
    .addCookies([
      { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
    ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  if (await page.getByTestId("tour-overlay").isVisible().catch(() => false)) {
    await page
      .getByTestId("tour-overlay")
      .getByRole("button", { name: /^skip$/i })
      .click();
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  }
  return page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
}

test("quick-view: stale Save raises the conflict dialog", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const wsId = await signup(page);
  await page.goto(`/w/${wsId}/boards`).catch(() => page.goto(`/w/${wsId}/boards`));
  await expect(async () => {
    await page.getByRole("button", { name: /new board/i }).click();
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("QV Conflict");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  const column = page
    .locator("[data-list-id]")
    .filter({ hasText: "Tasks" })
    .first();
  await column.getByTestId("list-add-card").click();
  await page.getByTestId("roadmap-new-card-title").fill("Shared");
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const boardUrl = page.url().replace(/\?.*$/, "") + "?assignee=all";

  // Two windows on the SAME board.
  const a = page;
  const b = await context.newPage();
  await a.goto(boardUrl);
  await b.goto(boardUrl);
  const tileA = a.locator("[data-card-id]").filter({ hasText: "Shared" }).first();
  const tileB = b.locator("[data-card-id]").filter({ hasText: "Shared" }).first();
  await expect(tileA).toBeVisible();
  await expect(tileB).toBeVisible();

  // Open the quick view in BOTH (both capture the same baseline rev),
  // then edit the title in each before either saves.
  await tileA.click();
  await expect(a.getByTestId("card-quick-view")).toBeVisible();
  await tileB.click();
  await expect(b.getByTestId("card-quick-view")).toBeVisible();

  // Title is click-to-edit: click the title text span, fill the input.
  await a.getByTestId("card-quick-view-title").getByText("Shared").click();
  await a.getByTestId("card-quick-view-title-edit").fill("Versione A");
  await a.getByTestId("card-quick-view-title-edit").press("Enter");
  await b.getByTestId("card-quick-view-title").getByText("Shared").click();
  await b.getByTestId("card-quick-view-title-edit").fill("Versione B");
  await b.getByTestId("card-quick-view-title-edit").press("Enter");

  // Save A first → bumps rev. Then Save B (stale) → must conflict.
  await a.getByTestId("card-quick-view-confirm-save")
    .or(a.getByRole("button", { name: /^save$/i }))
    .first()
    .click();
  await expect(a.getByTestId("card-quick-view")).toHaveCount(0);
  await b.getByTestId("card-quick-view-confirm-save")
    .or(b.getByRole("button", { name: /^save$/i }))
    .first()
    .click();
  await expect(b.getByTestId("edit-conflict-dialog")).toBeVisible({
    timeout: 10_000,
  });
});
