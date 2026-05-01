import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
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

async function signupAndLandOnDefaultWorkspace(page: Page) {
  const email = `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const link = await fetchConfirmLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

async function openCardModal(page: Page, cardTitle: string) {
  // CardTile is a <Link> wrapped around the card title; click anywhere on it.
  const tile = page.locator("[data-card-id]").filter({ hasText: cardTitle }).first();
  await tile.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeCardModal(page: Page) {
  // The dialog has both a built-in X close button and our footer Close
  // button; press Escape to avoid the strict-mode locator collision.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("card features: labels + due date + comment", async ({ page }) => {
  // 1. Sign up and land on default workspace.
  await signupAndLandOnDefaultWorkspace(page);

  // 2. Create a board. Two-step dialog post Plan #16b-γ-B.
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Card Features");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Card Features" })).toBeVisible();
  const boardUrl = page.url();

  // 3. Add a list.
  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  await expect(
    page.locator("[data-list-id]").filter({ hasText: "Tasks" }),
  ).toBeVisible();

  // 4. Add a card.
  const tasksColumn = page
    .locator("[data-list-id]")
    .filter({ hasText: "Tasks" })
    .first();
  await tasksColumn.getByRole("button", { name: "+ Add a card" }).click();
  await tasksColumn.getByPlaceholder("Card title").fill("Ship it");
  await tasksColumn.getByRole("button", { name: /^add$/i }).click();
  await expect(tasksColumn.getByText("Ship it")).toBeVisible();

  // 5. Open modal, create a label, attach it.
  await openCardModal(page, "Ship it");
  const labelsSection = page.getByTestId("labels-section");
  await labelsSection.getByLabel("New label").fill("Important");
  await labelsSection.getByRole("button", { name: /^add$/i }).click();

  // The new label appears as a button inside the section.
  const labelChip = labelsSection.locator("[data-label-id]").filter({
    hasText: "Important",
  });
  await expect(labelChip).toBeVisible();

  // Click it to attach to the card.
  await labelChip.click();
  await expect(labelChip).toHaveAttribute("data-attached", "true");

  // 6. Set a due date on the same modal pass.
  // Use a far-future date to avoid overdue formatting variability.
  const futureDate = "2099-12-31";
  await page.getByLabel("Due date").fill(futureDate);

  // Give the server-action POST a moment to commit before closing.
  await page.waitForTimeout(800);

  // 7. Add a comment.
  const commentsSection = page.getByTestId("comments-section");
  await commentsSection.getByLabel("New comment").fill("Looks good to me!");
  await commentsSection.getByRole("button", { name: /^save$/i }).click();
  await expect(
    commentsSection.locator("[data-comment-id]").filter({
      hasText: "Looks good to me!",
    }),
  ).toBeVisible();

  // 8. Close modal, verify tile shows label stripe + due pill.
  await closeCardModal(page);

  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Ship it" })
    .first();
  await expect(tile.getByTestId("label-stripes")).toBeVisible();
  await expect(tile.getByTestId("due-pill")).toBeVisible();

  // 9. Reload — everything must persist.
  await page.goto(boardUrl);
  await expect(page.getByRole("heading", { name: "Card Features" })).toBeVisible();
  const tile2 = page
    .locator("[data-card-id]")
    .filter({ hasText: "Ship it" })
    .first();
  await expect(tile2.getByTestId("label-stripes")).toBeVisible();
  await expect(tile2.getByTestId("due-pill")).toBeVisible();

  await openCardModal(page, "Ship it");
  // Label still attached.
  const reLabelsSection = page.getByTestId("labels-section");
  await expect(
    reLabelsSection
      .locator("[data-label-id]")
      .filter({ hasText: "Important" }),
  ).toHaveAttribute("data-attached", "true");

  // Due date still present.
  await expect(page.getByLabel("Due date")).toHaveValue(futureDate);

  // Comment still present.
  await expect(
    page
      .getByTestId("comments-section")
      .locator("[data-comment-id]")
      .filter({ hasText: "Looks good to me!" }),
  ).toBeVisible();
});
