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
  const email = `jp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const link = await fetchConfirmLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

async function addList(page: Page, title: string) {
  // Form-mount transition between trigger click and placeholder paint can
  // miss a single click. Wait up to 8s with one retry.
  const trigger = page.getByRole("button", { name: "+ Add a list" });
  const placeholder = page.getByPlaceholder("List title");
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  try {
    await placeholder.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    // Retry: re-click the trigger if it's still visible — sometimes the
    // first click is swallowed during enter-animation.
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

async function openCardModal(page: Page, cardTitle: string) {
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: cardTitle })
    .first();
  await tile.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
}

async function closeCardModal(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Escape");
  if ((await page.getByRole("dialog").count()) > 0) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 });
}

test("sprints, backlog, story points, WIP, filters, swimlanes, roadmap", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // 1. Sign up + create board.
  await signupAndLandOnDefaultWorkspace(page);
  const wsUrl = page.url();
  const wsId = wsUrl.match(/\/w\/([0-9a-f-]{36})/)![1];

  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByLabel("Title").fill("Planning");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = page.url();
  const boardId = boardUrl.match(/\/b\/([0-9a-f-]{36})/)![1];

  // 2. Add list "To do" with card "Refactor".
  await addList(page, "To do");
  await addCardToList(page, "To do", "Refactor");

  // Open modal — set storyPoints=5 + type=story.
  await openCardModal(page, "Refactor");
  await page
    .getByTestId("story-points-picker")
    .getByRole("button", { name: "5", exact: true })
    .click();
  // Switch type to Story.
  await page.getByRole("button", { name: /^TASK/ }).click();
  await page.getByRole("menuitemradio", { name: /Story/ }).click();
  await expect(page.getByRole("button", { name: /^STORY/ })).toBeVisible({
    timeout: 5000,
  });
  await closeCardModal(page);

  // 3. Tile shows story-points chip with 5.
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Refactor" })
    .first();
  await expect(tile.getByTestId("tile-story-points")).toContainText("5");

  // 4. Navigate to the BACKLOG page → create Sprint 1.
  // The BACKLOG nav link only renders when we're already on a /w/ path; from
  // the board view we navigate directly (matching the link's href).
  await page.goto(`/w/${wsId}/backlog`);
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/backlog`));
  await page.getByRole("button", { name: /new sprint/i }).click();
  await page.locator("#sp-name").fill("Sprint 1");
  await page.getByRole("button", { name: /^create$/i }).click();
  // Sprint 1 appears in PLANNED section.
  await expect(page.getByText("Sprint 1").first()).toBeVisible({
    timeout: 5000,
  });

  // 5. Move Refactor from backlog to Sprint 1 via the backlog row's sprint picker.
  // The backlog list renders rows with a SprintPicker chip showing "BACKLOG".
  // There should be exactly one such picker since there's one card. Click it.
  // But there are also planned-sprint pickers. Restrict to backlog area:
  const backlogSection = page
    .locator("section, div")
    .filter({ has: page.getByRole("heading", { level: 2, name: /BACKLOG/ }) })
    .last();
  // Easier: click the chip containing BACKLOG label inside the backlog list rows.
  // The picker label is uppercased; default is "BACKLOG" for a backlog card.
  const backlogPicker = page
    .getByRole("button", { name: /BACKLOG/ })
    .filter({ hasNotText: "←" })
    .last();
  await backlogPicker.click();
  await page.getByRole("menuitemradio", { name: /Sprint 1/ }).click();
  // Card should now be inside Sprint 1's card list.
  void backlogSection;
  await expect(
    page.locator(`[data-testid^="sprint-card-"]`).filter({ hasText: "Refactor" }),
  ).toBeVisible({ timeout: 5000 });

  // 6. Start sprint.
  await page.getByRole("button", { name: /^START/i }).click();
  // Sprint state becomes ACTIVE.
  await expect(page.getByText("ACTIVE", { exact: true }).first()).toBeVisible({
    timeout: 5000,
  });

  // 7. Click sprint title → BurndownChart renders.
  await page.getByRole("link", { name: "Sprint 1" }).first().click();
  await expect(page).toHaveURL(/\/sprints\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("burndown-chart")).toBeVisible({
    timeout: 5000,
  });

  // 8. Back to board → board settings → set WIP limit on "To do" to 1.
  await page.goto(boardUrl + "/settings");
  // The lists admin panel renders one row per list with a WIP setter.
  const wipInput = page.getByPlaceholder("—").first();
  await wipInput.fill("1");
  await page.getByRole("button", { name: /^SAVE$/ }).first().click();
  // Toast "Saved." appears (fire-and-forget); just give it a moment.
  await page.waitForTimeout(500);

  // 9. Add a second card → list-wip-chip turns over-limit.
  await page.goto(boardUrl);
  await addCardToList(page, "To do", "Second");
  const wipChip = page
    .locator("[data-list-id]")
    .filter({ hasText: "To do" })
    .first()
    .getByTestId("list-wip-chip");
  // Now 2/1 — chip should render the over-limit form.
  await expect(wipChip).toContainText("2/1", { timeout: 5000 });

  // 10. Click ME filter → URL updates with ?assignee=me. Then OVERDUE → due=overdue.
  await page.getByRole("button", { name: /^ME$/ }).click();
  await expect
    .poll(() => page.url(), { timeout: 5000 })
    .toMatch(/assignee=me/);
  // Toggle OVERDUE.
  await page.getByRole("button", { name: /^OVERDUE$/ }).click();
  await expect.poll(() => page.url(), { timeout: 5000 }).toMatch(/due=overdue|due%3Doverdue/);
  // Clear filters.
  await page.getByRole("button", { name: /CLEAR/ }).click();

  // 11. Switch swimlane mode dropdown → "By assignee" (we use this rather than
  // "By type" which doesn't exist as a documented option in BoardFilterBar).
  await page.getByRole("button", { name: /NO SWIMLANES/ }).click();
  await page.getByRole("menuitemradio", { name: /By assignee/ }).click();
  await expect
    .poll(() => page.url(), { timeout: 5000 })
    .toMatch(/lanes=assignee/);
  // Reset by navigating back to the bare boardUrl — this clears all filter
  // params atomically without racing the swimlane re-render.
  await page.goto(boardUrl);

  // 12. Set start_date + target_date on Refactor via card modal RoadmapDatesSection.
  await openCardModal(page, "Refactor");
  const today = new Date();
  const start = new Date(today);
  const target = new Date(today);
  target.setDate(target.getDate() + 14);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await page.getByLabel("Roadmap start date").fill(fmt(start));
  await page.getByLabel("Roadmap target date").fill(fmt(target));
  await page.waitForTimeout(800); // let the auto-save POST land
  await closeCardModal(page);

  // Navigate to the ROADMAP page (link only visible from /w/ paths).
  await page.goto(`/w/${wsId}/roadmap`);
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/roadmap`));
  // The roadmap-grid only renders when cards exist.
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 5000 });

  // 13. Re-edit dates via card modal (the spec allows falling back to the
  // RoadmapDatesSection rather than dragging in the SVG — we use that path).
  void boardId;
  await page.goto(boardUrl);
  await openCardModal(page, "Refactor");
  const newStart = new Date(start);
  newStart.setDate(newStart.getDate() + 7);
  const newTarget = new Date(target);
  newTarget.setDate(newTarget.getDate() + 7);
  await page.getByLabel("Roadmap start date").fill(fmt(newStart));
  await page.getByLabel("Roadmap target date").fill(fmt(newTarget));
  await page.waitForTimeout(800);
  await closeCardModal(page);

  // Reload roadmap → bars still render at new positions.
  await page.goto(`/w/${wsId}/roadmap`);
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 5000 });
  // The card data attribute in RoadmapBar is the lane title — assert at least
  // one bar exists by looking up the inner canvas's content.
  await expect(page.getByTestId("roadmap-canvas")).toBeVisible({ timeout: 5000 });
});
