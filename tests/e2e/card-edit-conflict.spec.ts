import { test, expect, type Page } from "@playwright/test";

// card-edit-concurrency U3 — proves the silent last-write-wins clobber
// is dead: two tabs on the same card, the stale saver gets the
// keep-yours/take-theirs dialog instead of overwriting blind.

async function signupAndLandOnDefaultWorkspace(page: Page) {
  const email = `cec-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
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

test("stale title save gets the conflict dialog; take-theirs and keep-mine both work", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const wsId = await signupAndLandOnDefaultWorkspace(page);

  // Scaffold board + list + card.
  await page.goto(`/w/${wsId}/boards`).catch(() => page.goto(`/w/${wsId}/boards`));
  await expect(async () => {
    await page.getByRole("button", { name: /new board/i }).click();
    await expect(
      page.getByRole("button", { name: /^continue$/i }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Conflict QA");
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
  await page.getByTestId("roadmap-new-card-title").fill("Shared card");
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  {
    const url = new URL(page.url());
    url.searchParams.set("assignee", "all");
    await page.goto(url.toString());
  }
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Shared card" })
    .first();
  const cardId = await tile.getAttribute("data-card-id");
  const boardId = page.url().match(/\/b\/([0-9a-f-]{36})/)![1];
  const cardUrl = `/b/${boardId}/c/${cardId}`;

  // Two tabs on the same card (same account — staleness is about the
  // open editor, not the user).
  const a = page;
  const b = await context.newPage();
  await a.goto(cardUrl);
  await expect(a.locator("#card-title")).toBeVisible();
  await b.goto(cardUrl);
  await expect(b.locator("#card-title")).toBeVisible();

  // B starts editing FIRST (captures its rev baseline on focus)...
  await b.locator("#card-title").click();
  // ...then A lands a save in the meantime.
  await a.locator("#card-title").fill("From A");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(a.getByTestId("undo-banner")).toBeVisible();

  // B saves over it → conflict dialog, nothing clobbered.
  await b.locator("#card-title").fill("From B");
  await b.locator("body").click({ position: { x: 5, y: 5 } });
  const dialog = b.getByTestId("edit-conflict-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("conflict-mine")).toContainText("From B");
  await expect(dialog.getByTestId("conflict-theirs")).toContainText("From A");

  // TAKE THEIRS → B's editor adopts A's text, no write happened.
  await dialog.getByTestId("conflict-take-theirs").click();
  await expect(dialog).toHaveCount(0);
  await expect(b.locator("#card-title")).toHaveValue("From A");

  // KEEP MINE wiring: a second stale save re-opens the dialog; choosing
  // "keep mine" re-saves over it and closes the dialog. (The server-side
  // retry-with-fresh-rev contract is proven deterministically in the U2
  // integration test; cross-tab final-state timing is realtime-dependent
  // and intentionally not asserted here.)
  await b.locator("#card-title").click();
  await a.locator("#card-title").fill("From A2");
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(a.getByText(/Title updated/).first()).toBeVisible();

  await b.locator("#card-title").fill("From B2");
  await b.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("conflict-keep-mine").click();
  await expect(dialog).toHaveCount(0);
});

test("description autosave persists and consecutive bursts do not self-conflict", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const wsId = await signupAndLandOnDefaultWorkspace(page);
  await page.goto(`/w/${wsId}/boards`).catch(() => page.goto(`/w/${wsId}/boards`));
  await expect(async () => {
    await page.getByRole("button", { name: /new board/i }).click();
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Desc QA");
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
  await page.getByTestId("roadmap-new-card-title").fill("Notes card");
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  {
    const url = new URL(page.url());
    url.searchParams.set("assignee", "all");
    await page.goto(url.toString());
  }
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Notes card" })
    .first();
  const cardId = await tile.getAttribute("data-card-id");
  const boardId = page.url().match(/\/b\/([0-9a-f-]{36})/)![1];
  await page.goto(`/b/${boardId}/c/${cardId}`);
  await expect(page.locator("#card-title")).toBeVisible();

  // First burst (rev 0 baseline) → persists after debounce.
  await page.getByTestId("card-modal-notes-empty").click();
  const desc = page.locator("#card-description");
  await desc.fill("first version");
  await page.waitForTimeout(1500); // debounce (600ms) + save round-trip

  // Second burst, same editor, no reload: must NOT self-conflict (the
  // client re-armed its rev from the first save's response).
  await desc.fill("first version, then more");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("edit-conflict-dialog")).toHaveCount(0);

  // Reload proves both bursts landed.
  await page.reload();
  await expect(page.getByTestId("card-modal-notes-view")).toContainText(
    "then more",
  );
});
