import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
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

async function signupAndLand(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  // After T7-T8, "/" redirects to most-recent workspace. So URL should be /w/{uuid}.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

test("workspace+board lifecycle", async ({ page }) => {
  const email = `wb-${Date.now()}@example.com`;
  await signupAndLand(page, email);

  // Open workspace switcher in nav, click "New workspace".
  // The switcher button shows the current workspace name (e.g. "wb-1234567's Workspace") + chevron.
  // It is the FIRST <button> inside <header> (Log out is the second).
  await page.locator("header").getByRole("button").first().click();
  await page.getByRole("menuitem", { name: /new workspace/i }).click();

  await page.getByLabel("Name").fill("Side Project");
  await page.getByRole("button", { name: /^create$/i }).click();
  // Should navigate to the new workspace; landing now redirects to /roadmap.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  // Open the board grid (now lives at /w/{id}/boards) so the workspace
  // heading + new-board CTA are visible.
  await page.getByTestId("nav-boards").click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);
  await expect(page.getByRole("heading", { name: "Side Project" })).toBeVisible();

  // Create board (step 1: pick template — "Blank" is selected by default,
  // step 2: fill title + tone). Plan #16b-γ-B added the template picker.
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Roadmap");
  await page.getByRole("button", { name: /create board/i }).click();
  // Lands on /b/{uuid}
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();

  // Board settings → archive → workspace home shows no Roadmap
  // The "Board settings" element is rendered as a styled link (Button with render={<Link/>}).
  await page.getByText(/board settings/i).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/settings/);
  await page.getByRole("button", { name: /archive board/i }).click();
  // After archive, the form re-renders showing "Restore from archive"
  await expect(page.getByRole("button", { name: /restore from archive/i })).toBeVisible();

  // Navigate back to the workspace via the breadcrumb-style link
  await page.getByRole("link", { name: "Trello Clone" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  // Open the board grid (workspace landing now redirects to /roadmap).
  await page.getByTestId("nav-boards").click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);
  // Roadmap should not appear in the grid (archived boards filtered out).
  // Scope the assertion to board tiles so it doesn't match the ROADMAP nav link.
  await expect(
    page.locator("[data-board-id]").filter({ hasText: "Roadmap" }),
  ).toHaveCount(0);
});
