import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (list.ok()) {
      const data = await list.json();
      if (data.messages && data.messages.length > 0) {
        const id = data.messages[0].ID;
        const detail = await api.get(`/api/v1/message/${id}`);
        const msg = await detail.json();
        const body: string = msg.HTML || msg.Text || "";
        const m =
          body.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ??
          body.match(/(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email arrived for ${email}`);
}

async function signupAndCreateBoard(page: Page) {
  const email = `sa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
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

  // Activity feed should show "created list" + "created card"
  const feed = page.getByTestId("activity-feed");
  await expect(feed).toBeVisible({ timeout: 5000 });
  await expect(feed).toContainText("created list");
  await expect(feed).toContainText("created card");

  // Reload to make sure activity persists
  await page.reload();
  await expect(page.getByTestId("activity-feed")).toContainText("created card");

  // Search for "widget"
  await page.getByTestId("search-box").fill("widget");
  const results = page.getByTestId("search-results");
  await expect(results).toBeVisible({ timeout: 3000 });
  await expect(results).toContainText("Investigate widget bug");
  // Click result → navigate to card
  await results.getByText("Investigate widget bug").click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}/);
});
