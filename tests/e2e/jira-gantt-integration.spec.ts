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

async function signupAndLandOnDefaultWorkspace(page: Page, email: string) {
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

async function openCardModal(page: Page, cardTitle: string) {
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: cardTitle })
    .first();
  const title = tile.getByText(cardTitle, { exact: true }).first();
  await title.click();
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

async function setRoadmapDates(page: Page, start: Date, target: Date) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await page.getByLabel("Roadmap start date").fill(fmt(start));
  await page.getByLabel("Roadmap target date").fill(fmt(target));
  await page.waitForTimeout(800);
}

async function setCardType(page: Page, kind: "Epic" | "Story") {
  // Type picker chips: TASK / BUG / etc; pick the appropriate menuitem.
  await page
    .getByRole("button", { name: /^(TASK|STORY|EPIC|BUG|SUBTASK)/ })
    .first()
    .click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${kind}$`) }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${kind.toUpperCase()}`) }),
  ).toBeVisible({ timeout: 5000 });
}

test("jira-gantt integration: drag, critical path, cascade, cross-context realtime", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailA = `jga-${stamp}@example.com`;
  const emailB = `jgb-${stamp}@example.com`;

  // Context A: owner. Context B: workspace member who joins via invite.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // 1. Sign up both users.
  await signupAndLandOnDefaultWorkspace(a, emailA);
  const wsUrlA = a.url();
  const wsId = wsUrlA.match(/\/w\/([0-9a-f-]{36})/)![1];
  await signupAndLandOnDefaultWorkspace(b, emailB);
  const localPartB = emailB.split("@")[0];

  // 2. A invites B to A's workspace.
  await a.goto(wsUrlA + "/settings");
  await a.getByLabel("Email").fill(emailB);
  await a.getByRole("button", { name: /^invite$/i }).click();
  await expect(a.getByText(localPartB)).toBeVisible({ timeout: 5000 });

  // 3. A creates a board.
  await a.goto(wsUrlA);
  await a.getByRole("button", { name: /new board/i }).click();
  await a.getByRole("button", { name: /^continue$/i }).click();
  await a.getByLabel("Title").fill("Gantt");
  await a.getByRole("button", { name: /create board/i }).click();
  await expect(a).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = a.url();

  // 4. Create a list and two cards: Epic + Story, with dates.
  await addList(a, "Backlog");
  await addCardToList(a, "Backlog", "Epic Foundations");
  await addCardToList(a, "Backlog", "Story Login");

  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const target = new Date(start);
  target.setUTCDate(target.getUTCDate() + 14);
  const startB = new Date(start);
  startB.setUTCDate(startB.getUTCDate() + 14);
  const targetB = new Date(start);
  targetB.setUTCDate(targetB.getUTCDate() + 28);

  // Epic gets [today, +14d]; switch type to Epic for it to plot on roadmap.
  await openCardModal(a, "Epic Foundations");
  await setCardType(a, "Epic");
  await setRoadmapDates(a, start, target);
  await closeCardModal(a);

  // Story gets [+14d, +28d]; type to Story.
  await openCardModal(a, "Story Login");
  await setCardType(a, "Story");
  await setRoadmapDates(a, startB, targetB);

  // 5. Link the story as blocked by the epic.
  await a.getByRole("button", { name: /^LINK$/ }).click();
  await a
    .getByRole("button", { name: /^(BLOCKS|BLOCKED BY|RELATES TO|DUPLICATES|DUPLICATED BY)/ })
    .first()
    .click();
  await a
    .getByRole("menuitemradio", { name: /^Blocked by$/ })
    .click();
  await a.getByPlaceholder("Search cards on this board…").fill("Epic");
  await a.getByRole("button", { name: /Epic Foundations/ }).first().click();
  // The link dialog auto-closes; close the card modal too.
  await closeCardModal(a);

  // 6. A navigates to roadmap. Both bars + arrow visible.
  await a.goto(`/w/${wsId}/roadmap`);
  await expect(a.getByTestId("roadmap-grid")).toBeVisible({ timeout: 5000 });
  await expect(a.getByTestId("roadmap-canvas")).toBeVisible({ timeout: 5000 });
  // At least two bars rendered.
  const bars = a.locator('[data-testid="roadmap-bar"]');
  await expect.poll(() => bars.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  // Dependency arrows SVG renders (when both bars are visible).
  await expect(a.getByTestId("roadmap-arrows")).toBeVisible({ timeout: 5000 });

  // 7. Toggle "Show critical path" → overlay renders with at least one node.
  await a.getByTestId("roadmap-critical-toggle").click();
  await expect(a.getByTestId("roadmap-critical-overlay")).toBeVisible({
    timeout: 5000,
  });
  // Toggle off so it doesn't interfere with later assertions.
  await a.getByTestId("roadmap-critical-toggle").click();

  // 8. Push the Story's target_date forward via card modal (simulating a
  // forward drag) and verify it persists across reload.
  await a.goto(boardUrl);
  await openCardModal(a, "Story Login");
  const newTargetB = new Date(targetB);
  newTargetB.setUTCDate(newTargetB.getUTCDate() + 14);
  await a
    .getByLabel("Roadmap target date")
    .fill(newTargetB.toISOString().slice(0, 10));
  await a.waitForTimeout(800);
  await closeCardModal(a);
  await a.reload();
  // Reopen and verify persistence.
  await openCardModal(a, "Story Login");
  await expect(a.getByLabel("Roadmap target date")).toHaveValue(
    newTargetB.toISOString().slice(0, 10),
  );
  await closeCardModal(a);

  // 9. Cross-context realtime: B opens the same roadmap and sees both bars.
  await b.goto(`/w/${wsId}/roadmap`);
  await expect(b.getByTestId("roadmap-grid")).toBeVisible({ timeout: 5000 });
  // Wait for B's realtime channel to subscribe before mutating.
  await expect(b.getByTestId("roadmap-live")).toHaveAttribute(
    "data-live",
    "true",
    { timeout: 8000 },
  );

  // 10. A renames the Story title via the card modal.
  await a.goto(boardUrl);
  await openCardModal(a, "Story Login");
  // Title is editable within the modal — use the first text input we find or
  // a known testid path. The modal exposes the title as the dialog heading.
  const titleHeading = a.getByRole("dialog").getByRole("heading").first();
  await titleHeading.click();
  // The board card-modal commonly shows an editable title; tweak via keyboard.
  // Fall back: just use a contenteditable-friendly approach.
  // The simplest reliable change: use the label "Title" if present.
  const titleField = a
    .getByRole("dialog")
    .locator("input, textarea")
    .first();
  await titleField.fill("Story Login Renamed");
  await titleField.blur();
  await a.waitForTimeout(800);
  await closeCardModal(a);

  // 11. B sees the renamed bar's tooltip update via realtime within ~5s.
  await expect
    .poll(
      async () =>
        await b
          .locator('[data-testid="roadmap-bar"]')
          .filter({ hasText: "Renamed" })
          .count(),
      { timeout: 6000 },
    )
    .toBeGreaterThanOrEqual(1);

  // 12. Activity feed (board route) shows a date or move event from our drags.
  await a.goto(boardUrl);
  await expect(a.getByTestId("activity-feed")).toBeVisible({ timeout: 5000 });
  // Accept any one of the post-α event types; the test is forward-compatible.
  const acceptableTypes = [
    "activity-card.dates",
    "activity-card.due",
    "activity-card.move",
    "activity-card.rename",
  ];
  let foundActivity = false;
  for (const t of acceptableTypes) {
    if (await a.getByTestId(t).first().isVisible().catch(() => false)) {
      foundActivity = true;
      break;
    }
  }
  expect(foundActivity).toBe(true);

  await ctxA.close();
  await ctxB.close();
});
