import { test, expect, type Page } from "@playwright/test";

// undo-redo-stack Unit D1 — cross-surface evidence spec.
// Covers: multi-step keyboard undo/redo (A1+A2), banner dismiss keeping
// the entry (A1), focus guard (A2), board-field redo (E1), milestone
// create undo/redo with id rebirth (C1), and cross-surface invocation
// (an entry pushed on the roadmap undone from the boards page).

async function signupAndLandOnDefaultWorkspace(page: Page) {
  // Allowed domain (the email-domain hook rejects @example.com).
  const email = `ur-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
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

async function gotoRetry(page: Page, path: string, urlPattern: RegExp) {
  await page.goto(path).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await page.goto(path);
    } else {
      throw e;
    }
  });
  await expect(page).toHaveURL(urlPattern);
}

async function gotoBoards(page: Page, wsId: string) {
  await gotoRetry(page, `/w/${wsId}/boards`, /\/w\/[0-9a-f-]{36}\/boards/);
}

test("board: multi-step undo/redo via keyboard, banner dismiss keeps entry, focus guard", async ({
  page,
}) => {
  const wsId = await signupAndLandOnDefaultWorkspace(page);
  await gotoBoards(page, wsId);

  // Board + list + card scaffolding (mirrors card-features.spec.ts).
  await expect(async () => {
    await page.getByRole("button", { name: /new board/i }).click();
    await expect(
      page.getByRole("button", { name: /^continue$/i }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Undo QA");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  const tasksColumn = page
    .locator("[data-list-id]")
    .filter({ hasText: "Tasks" })
    .first();
  await tasksColumn.getByTestId("list-add-card").click();
  await page.getByTestId("roadmap-new-card-title").fill("Ship it");
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  {
    const url = new URL(page.url());
    url.searchParams.set("assignee", "all");
    await page.goto(url.toString());
  }
  await expect(tasksColumn.getByText("Ship it")).toBeVisible();

  // Open the card modal, attach a label (undo entry #1).
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: "Ship it" })
    .first();
  const cardId = await tile.getAttribute("data-card-id");
  const boardId = page.url().match(/\/b\/([0-9a-f-]{36})/)![1];
  await page.goto(`/b/${boardId}/c/${cardId}`);
  await expect(page.locator("#card-title")).toBeVisible();
  await page.getByTestId("card-modal-group-work").locator("summary").click();
  const labelsSection = page.getByTestId("labels-section");
  await labelsSection.getByLabel("New label").fill("Important");
  await labelsSection.getByRole("button", { name: /^add$/i }).click();
  const labelChip = labelsSection
    .locator("[data-label-id]")
    .filter({ hasText: "Important" });
  await labelChip.click();
  await expect(labelChip).toHaveAttribute("data-attached", "true");
  await expect(page.getByTestId("undo-banner")).toBeVisible();

  // Undo entry #2: due date.
  await page
    .getByTestId("card-modal-group-planning")
    .locator("summary")
    .click();
  await page
    .getByTestId("due-section")
    .getByTestId("date-picker-display")
    .fill("31/12/2099");
  await page.waitForTimeout(800);

  // FOCUS GUARD: Ctrl+Z while focused in the title input must NOT fire
  // app undo (no "Undid:" toast).
  await page.locator("#card-title").click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  await expect(page.getByText(/^Undid:/)).toHaveCount(0);

  // Blur the field, then walk the stack: due date first (LIFO)...
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Due date updated/)).toBeVisible();
  // ...then the label.
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Added Important/)).toBeVisible();
  await expect(labelChip).toHaveAttribute("data-attached", "false");

  // REDO (E1): Ctrl+Shift+Z re-attaches the label.
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText(/Redid: Added Important/)).toBeVisible();
  await expect(labelChip).toHaveAttribute("data-attached", "true");

  // BANNER DISMISS KEEPS ENTRY (A1): new action → dismiss banner → Ctrl+Z
  // still undoes it.
  await labelChip.click(); // detach → "Removed Important" pushed
  await expect(labelChip).toHaveAttribute("data-attached", "false");
  const banner = page.getByTestId("undo-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: /dismiss/i }).click();
  await expect(banner).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Removed Important/)).toBeVisible();
  await expect(labelChip).toHaveAttribute("data-attached", "true");
});

test("roadmap: milestone create undone from the boards page, redone on roadmap (cross-surface + id rebirth)", async ({
  page,
}) => {
  const wsId = await signupAndLandOnDefaultWorkspace(page);

  // Roadmap: create a milestone (undo entry pushed on the roadmap).
  await gotoRetry(page, `/w/${wsId}/roadmap`, /\/w\/[0-9a-f-]{36}\/roadmap/);
  await page.getByTestId("roadmap-add-milestone").click();
  const dialog = page.getByTestId("milestone-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("QA M1");
  await dialog.getByTestId("date-picker-display").fill("15/08/2026");
  // Click outside the date popover (it overlays the footer) to close it,
  // then save — the earlier Escape path put the dialog in its confirm
  // phase on dirty forms, so accept either footer variant.
  await dialog.getByLabel("Name").click();
  await expect(
    page.getByRole("dialog", { name: "Pick date" }),
  ).toHaveCount(0);
  await dialog
    .getByTestId("milestone-dialog-confirm-save")
    .or(dialog.getByTestId("milestone-dialog-close"))
    .first()
    .click();
  await expect(page.getByText(/Milestone created/)).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // CROSS-SURFACE: client-side navigate to boards (g b nav chord — a
  // full page.goto would reload the document and drop the in-memory
  // bus, which is the documented refresh behavior, not a bug).
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Milestone "QA M1" created/)).toBeVisible();

  // Back on the roadmap (g r) the milestone is gone.
  await page.keyboard.press("g");
  await page.keyboard.press("r");
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/roadmap/);
  await expect(
    page.getByTestId("milestone-markers").locator("text=QA M1"),
  ).toHaveCount(0);

  // REDO recreates it (new id — mutable binding keeps the entry live).
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText(/Redid: Milestone "QA M1" created/)).toBeVisible();
});

test("roadmap: Gantt bar drag is undoable and redoable (B1 commit path, live gesture)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const wsId = await signupAndLandOnDefaultWorkspace(page);
  await gotoBoards(page, wsId);

  // Scaffold: board + list + card (same flow as the first test).
  await expect(async () => {
    await page.getByRole("button", { name: /new board/i }).click();
    await expect(
      page.getByRole("button", { name: /^continue$/i }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Drag QA");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  const tasksColumn = page
    .locator("[data-list-id]")
    .filter({ hasText: "Tasks" })
    .first();
  await tasksColumn.getByTestId("list-add-card").click();
  await page.getByTestId("roadmap-new-card-title").fill("Drag me");
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  {
    const url = new URL(page.url());
    url.searchParams.set("assignee", "all");
    await page.goto(url.toString());
  }

  // The NewCardDialog creates the card already scheduled (default
  // 2-week span), so it lands on the roadmap without a promote step.
  await gotoRetry(page, `/w/${wsId}/roadmap`, /\/w\/[0-9a-f-]{36}\/roadmap/);
  const bar = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Drag me" })
    .first();
  await expect(bar).toBeVisible({ timeout: 8000 });

  // Capture the pre-drag start date from the bar's edit-dates dialog.
  async function readStartDate(): Promise<string> {
    await bar.hover();
    await bar.getByTestId("roadmap-bar-overflow").click();
    await page.getByTestId("roadmap-bar-menu-edit-dates").click();
    await expect(page.getByTestId("roadmap-bar-dates-dialog")).toBeVisible();
    const v = await page
      .getByTestId("roadmap-bar-dates-start")
      .getByTestId("date-picker-display")
      .inputValue();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("roadmap-bar-dates-dialog")).toHaveCount(0);
    return v;
  }
  const originalStart = await readStartDate();

  // Drag the bar body rightwards (move mode), far enough to change days.
  const box = await bar.boundingBox();
  if (!box) throw new Error("missing bar bbox");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 6, startY, { steps: 4 });
  await page.mouse.move(startX + 160, startY, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  // Undo restores the original start date; redo re-applies the drag.
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Rescheduled "Drag me"/)).toBeVisible();
  expect(await readStartDate()).toBe(originalStart);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText(/Redid: Rescheduled "Drag me"/)).toBeVisible();
  expect(await readStartDate()).not.toBe(originalStart);

  // Context-menu parity (unit G1): right-click → set priority pushes an
  // undo entry like every other mutation.
  await bar.click({ button: "right" });
  await page
    .locator('[data-testid="roadmap-bar-menu-set-priority"][data-priority="p1"]')
    .click();
  // The push surfaces in the banner with the entry message.
  await expect(
    page.getByTestId("undo-banner").getByText("Priority High"),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByText(/Undid: Priority High/)).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText(/Redid: Priority High/)).toBeVisible();
});
