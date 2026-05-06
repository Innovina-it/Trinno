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
  const email = `js-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.context().addCookies([{ name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" }]);
    await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

async function addList(page: Page, title: string) {
  const trigger = page.getByRole("button", { name: "+ Add a list" });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  await page.getByPlaceholder("List title").fill(title);
  await page.getByRole("button", { name: /^add list$/i }).click();
  await expect(
    page.locator(`[data-list-id]`).filter({ hasText: title }),
  ).toBeVisible({ timeout: 5000 });
}

async function addCardToList(page: Page, listTitle: string, cardTitle: string) {
  const column = page
    .locator("[data-list-id]")
    .filter({ hasText: listTitle })
    .first();
  const trigger = column.getByRole("button", { name: "+ Add a card" });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  await column.getByPlaceholder("Card title").fill(cardTitle);
  await column.getByRole("button", { name: /^add$/i }).click();
  await expect(column.getByText(cardTitle, { exact: true })).toBeVisible({
    timeout: 5000,
  });
}

async function openCardModal(page: Page, cardTitle: string) {
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: cardTitle })
    .first();
  await tile.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
}

async function closeCardModal(page: Page) {
  // Click the body of the dialog first to defocus any open inner widgets, then
  // press Escape to close the Dialog primitive. We retry once if needed.
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Escape");
  if ((await page.getByRole("dialog").count()) > 0) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 });
}

// FIXME: needs triage after recent UI/seed/onboarding changes (Plan #16b post-rebrand).

test.fixme("card type, parent breadcrumb, sub-tasks, links, components, versions all persist", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // 1. Sign up + create workspace board.
  await signupAndLandOnDefaultWorkspace(page);
  // After landing, the URL might be /w/{id}/roadmap (workspace landing now
  // redirects to roadmap). Derive the canonical /w/{id} prefix so wsUrl +
  // "/settings" composes correctly later, then visit /boards to access the
  // create-board CTA.
  const wsUrl = page.url().replace(/\/(roadmap|boards|backlog|all-tasks|versions)(\/.*)?$/, "");
  await page.goto(wsUrl + "/boards");

  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Jira Structure");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(
    page.getByRole("heading", { name: "Jira Structure" }),
  ).toBeVisible();
  const boardUrl = page.url();

  // 2. Add list "Triage" with two cards.
  await addList(page, "Triage");
  await addCardToList(page, "Triage", "Login flow");
  await addCardToList(page, "Triage", "Add OAuth");

  // 3. Open "Login flow" → set type=epic.
  await openCardModal(page, "Login flow");
  // Type chip currently shows "TASK"; open type-picker dropdown and select Epic.
  await page.getByRole("button", { name: /^TASK/ }).click();
  await page.getByRole("menuitemradio", { name: /Epic/ }).click();
  // Wait for the chip to update.
  await expect(page.getByRole("button", { name: /^EPIC/ })).toBeVisible({
    timeout: 5000,
  });
  await closeCardModal(page);

  // 4. Open "Add OAuth" → set parent to Login flow → set type=subtask.
  await openCardModal(page, "Add OAuth");
  await page.getByRole("button", { name: /SET PARENT/i }).click();
  // The parent picker opens a search dialog.
  await page
    .getByPlaceholder("Search cards on this board…")
    .fill("Login");
  // Click the result button.
  await page.getByRole("button", { name: /Login flow/ }).first().click();
  // Now set type=subtask on this card.
  await page.getByRole("button", { name: /^TASK/ }).click();
  await page.getByRole("menuitemradio", { name: /Sub-task/ }).click();
  await expect(page.getByRole("button", { name: /^SUB-TASK/ })).toBeVisible({
    timeout: 5000,
  });
  await closeCardModal(page);

  // 5. Reload — Add OAuth tile shows breadcrumb (CornerLeftUp icon + parent code).
  await page.goto(boardUrl);
  await expect(
    page.getByRole("heading", { name: "Jira Structure" }),
  ).toBeVisible();
  const oauthTile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Add OAuth" })
    .first();
  // The parent breadcrumb renders the parent's title (or "#<code>" fallback).
  await expect(
    oauthTile.getByTestId("tile-parent-breadcrumb"),
  ).toBeVisible();

  // 6. Open "Login flow" — sub-tasks section lists "Add OAuth".
  await openCardModal(page, "Login flow");
  const subtasks = page.getByTestId("subtasks-section");
  await expect(subtasks).toBeVisible();
  await expect(subtasks).toContainText("Add OAuth");

  // 7. Add a sub-task "Tokens" via inline create.
  await subtasks.getByRole("button", { name: /Add sub-task/i }).click();
  await subtasks.getByPlaceholder("What needs doing?").fill("Tokens");
  await subtasks.getByRole("button", { name: /^add$/i }).click();
  await expect(subtasks).toContainText("Tokens", { timeout: 5000 });
  await closeCardModal(page);

  // Tokens tile must appear in the column (it inherits the parent's list).
  await expect(
    page.locator("[data-card-id]").filter({ hasText: "Tokens" }).first(),
  ).toBeVisible({ timeout: 5000 });

  // 8. Add a card link from Login flow → Add OAuth (kind=blocks).
  await openCardModal(page, "Login flow");
  const linksSection = page.getByTestId("card-links-section");
  await expect(linksSection).toBeVisible();
  await linksSection.getByRole("button", { name: /LINK/ }).click();
  // Link dialog: kind defaults to "blocks". Search for Add OAuth.
  await page
    .getByPlaceholder("Search cards on this board…")
    .fill("Add OAuth");
  await page.getByRole("button", { name: /Add OAuth/ }).first().click();
  // Wait for link to land in the list.
  await expect(linksSection).toContainText(/BLOCKS/i, { timeout: 5000 });
  await closeCardModal(page);

  // Open Add OAuth — its links section should show "is_blocked_by Login flow".
  await openCardModal(page, "Add OAuth");
  const oauthLinks = page.getByTestId("card-links-section");
  await expect(oauthLinks).toContainText(/BLOCKED BY/i, { timeout: 5000 });
  await expect(oauthLinks).toContainText("Login flow");
  await closeCardModal(page);

  // 9. Board settings → Components panel → add "Frontend".
  await page.goto(boardUrl + "/settings");
  const componentsPanel = page.getByTestId("components-panel");
  await expect(componentsPanel).toBeVisible();
  await componentsPanel.getByLabel("New component").fill("Frontend");
  await componentsPanel.getByRole("button", { name: /^ADD$/i }).click();
  await expect(componentsPanel).toContainText("Frontend", { timeout: 5000 });

  // 10. Open a card modal (Login flow) → toggle Frontend on → close, reload, persists.
  await page.goto(boardUrl);
  await openCardModal(page, "Login flow");
  const compSection = page.getByTestId("components-section");
  await expect(compSection).toBeVisible();
  await compSection.getByLabel("Add component").click();
  // The dropdown menu shows component names.
  await page.locator(`[data-component-pick]`).first().click();
  // Attached chip appears.
  await expect(
    compSection.locator('[data-component-id][data-attached="true"]'),
  ).toBeVisible({ timeout: 5000 });
  await closeCardModal(page);

  await page.goto(boardUrl);
  await openCardModal(page, "Login flow");
  await expect(
    page
      .getByTestId("components-section")
      .locator('[data-component-id][data-attached="true"]'),
  ).toBeVisible({ timeout: 5000 });
  await closeCardModal(page);

  // 11. Workspace settings → add Version "v1.0" → open card → fixes=v1.0 → persist.
  await page.goto(wsUrl + "/settings");
  await page.getByRole("button", { name: /NEW VERSION/i }).click();
  // Use the dialog's Name input by id.
  await page.locator("#ver-name").fill("v1.0");
  await page.getByRole("button", { name: /^create$/i }).click();
  await expect(page.getByTestId("versions-panel")).toContainText("v1.0", {
    timeout: 5000,
  });

  await page.goto(boardUrl);
  await openCardModal(page, "Login flow");
  const versionsSection = page.getByTestId("version-card-section");
  await expect(versionsSection).toBeVisible();
  // Open the FIXES picker (label-based aria-label).
  await versionsSection.getByLabel("Add fixes version").click();
  await page
    .locator('[data-version-pick][data-version-kind="fixes"]')
    .first()
    .click();
  await expect(
    versionsSection.locator(
      '[data-version-id][data-version-kind="fixes"]',
    ),
  ).toBeVisible({ timeout: 5000 });
  await closeCardModal(page);

  // Reload → still set.
  await page.goto(boardUrl);
  await openCardModal(page, "Login flow");
  await expect(
    page
      .getByTestId("version-card-section")
      .locator('[data-version-id][data-version-kind="fixes"]'),
  ).toBeVisible({ timeout: 5000 });
});
