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

async function signupAndLand(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  const url = page.url();
  const wsMatch = url.match(/\/w\/([0-9a-f-]{36})/);
  if (!wsMatch) throw new Error(`no workspace in url: ${url}`);
  return { email, workspaceId: wsMatch[1] };
}

async function addList(page: Page, title: string) {
  const trigger = page.getByRole("button", { name: "+ Add a list" });
  const placeholder = page.getByPlaceholder("List title");
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  try {
    await placeholder.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
    }
    await placeholder.waitFor({ state: "visible", timeout: 8000 });
  }
  await placeholder.fill(title);
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

test("MY TASKS link in top nav navigates to aggregate view", async ({ page }) => {
  const { workspaceId } = await signupAndLand(page, "agg-nav");
  await page.goto(`/w/${workspaceId}`);
  await page.getByTestId("nav-all-tasks").click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/all-tasks`));
  await expect(page.getByTestId("all-tasks-view")).toBeVisible();
  // Empty state — fresh workspace has no boards.
  await expect(page.getByTestId("all-tasks-empty-no-boards")).toBeVisible();
});

test("dragging a card between status columns persists the move", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { workspaceId } = await signupAndLand(page, "agg-drag");
  await page.goto(`/w/${workspaceId}/boards`);

  // Create one board.
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Drag Test");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = page.url();
  const boardId = boardUrl.match(/\/b\/([0-9a-f-]{36})/)![1];

  // Add two lists and one card.
  await addList(page, "To Do");
  await addList(page, "In Progress");
  await addCardToList(page, "To Do", "Drag me");

  // Map both lists' status_kind via board settings.
  await page.goto(`/b/${boardId}/settings`);
  const selects = page.getByTestId("list-status-select");
  await expect(selects).toHaveCount(2, { timeout: 5000 });
  // First list -> todo, second list -> in_progress (DOM order matches creation).
  await selects.nth(0).selectOption("todo");
  await selects.nth(1).selectOption("in_progress");
  // Wait briefly for the server actions to settle.
  await page.waitForTimeout(800);

  // Navigate to the aggregate view and switch to ALL WORKSPACE so the
  // unassigned card shows.
  await page.goto(`/w/${workspaceId}/all-tasks`);
  await expect(page.getByTestId("all-tasks-view")).toBeVisible();
  await page
    .getByTestId("all-tasks-scope-toggle")
    .filter({ hasText: "ALL" })
    .click();

  const todoCol = page.locator(
    '[data-testid="all-tasks-column"][data-column-id="todo"]',
  );
  const inProgCol = page.locator(
    '[data-testid="all-tasks-column"][data-column-id="in_progress"]',
  );
  const card = page.getByTestId("all-tasks-card").first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // Card should start in TO DO.
  await expect(todoCol.getByTestId("all-tasks-card")).toHaveCount(1, {
    timeout: 5000,
  });

  // Drag card → in progress column.
  await card.dragTo(inProgCol);

  // Card should now be inside in_progress column.
  await expect(
    inProgCol.getByTestId("all-tasks-card").first(),
  ).toBeVisible({ timeout: 5000 });
  await expect(todoCol.getByTestId("all-tasks-card")).toHaveCount(0, {
    timeout: 5000,
  });

  // Reload — should persist.
  await page.reload();
  await page
    .getByTestId("all-tasks-scope-toggle")
    .filter({ hasText: "ALL" })
    .click();
  await expect(
    inProgCol.getByTestId("all-tasks-card").first(),
  ).toBeVisible({ timeout: 5000 });
});
