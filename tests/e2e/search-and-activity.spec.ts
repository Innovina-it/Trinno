import { test, expect, type Page } from "@playwright/test";

async function signupAndCreateBoard(page: Page) {
  const email = `sa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.context().addCookies([{ name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" }]);
    await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);

  // Workspace landing redirects to /roadmap; visit /boards for the new-board CTA.
  await page.getByTestId("nav-boards").click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);

  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Demo");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
}


test("search + activity", async ({ page }) => {
  await signupAndCreateBoard(page);

  // Add a list
  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("To do");
  await page.getByRole("button", { name: /^add list$/i }).click();
  await expect(
    page.locator("[data-list-id]").filter({ hasText: "To do" }),
  ).toBeVisible();

  // Add a card to "To do"
  const todoCol = page.locator("[data-list-id]").filter({ hasText: "To do" }).first();
  await todoCol.getByRole("button", { name: "+ Add a card" }).click();
  await todoCol.getByPlaceholder("Card title").fill("Investigate widget bug");
  await todoCol.getByRole("button", { name: /^add$/i }).click();
  await expect(todoCol.getByText("Investigate widget bug")).toBeVisible();

  // Activity feed should show "added list" + the card title (subject is
  // now rendered inline next to the verb).
  const feed = page.getByTestId("activity-feed");
  await expect(feed).toBeVisible({ timeout: 5000 });
  await expect(feed).toContainText("added list");
  await expect(feed).toContainText("Investigate widget bug");

  // Reload to make sure activity persists
  await page.reload();
  await expect(page.getByTestId("activity-feed")).toContainText(
    "Investigate widget bug",
  );

  // Search for "widget" via the command palette.
  await page.getByTestId("palette-trigger").click();
  await page.getByTestId("command-palette-input").fill("widget");
  const list = page.getByTestId("command-palette-list");
  await expect(list).toBeVisible({ timeout: 3000 });
  await expect(list).toContainText("Investigate widget bug");
  // Click result → navigate to card
  await list.getByText("Investigate widget bug").first().click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}/);
});
