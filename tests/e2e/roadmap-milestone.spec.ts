import { test, expect, type Page } from "@playwright/test";

// E2E coverage for the roadmap Milestone view (the fourth view-mode tab next to
// Gantt / List / Deliverable). This spec is the test bed for that feature:
//   - the four view-mode buttons exist and switch,
//   - a milestone added from the toolbar shows in the Milestone table with its
//     name, date and colour swatch,
//   - clicking the milestone name opens the existing edit dialog,
//   - the List view still renders (refactor parity — the Milestone view reuses
//     the same generic CardTable the List/Deliverable views are built on).
//
// Harness (signup) mirrors roadmap-deliverable.spec.ts.

const PW = "passw0rd!";

function uniqEmail(prefix: string, domain = "innovina.it"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${domain}`;
}

async function gotoWithRetry(page: Page, url: string) {
  await page.goto(url).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await page.goto(url);
    } else {
      throw e;
    }
  });
}

async function signupOwner(page: Page, email: string): Promise<string> {
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  return page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
}

// milestone-as-card: a milestone is now a card with type="milestone" hosted in
// a hidden list on a board, so the workspace needs at least one board before a
// milestone can be created. Create one through the real UI.
async function createBoard(page: Page) {
  await page.getByTestId("nav-boards").click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  const title = page.getByLabel("Title");
  await expect(title).toBeVisible();
  await title.fill("Board");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
}

async function addMilestone(page: Page, name: string, date: string) {
  await page.getByTestId("roadmap-add-milestone").click();
  const dialog = page.getByTestId("milestone-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Add milestone")).toBeVisible();

  await dialog.getByLabel("Name").fill(name);
  // The date field is a free-type dd/mm/yyyy input that commits on change and
  // pops a calendar on focus. Dismiss it by clicking back into the Name field
  // (inside the dialog, outside the picker) — pressing Escape would instead
  // hit the dialog's dirty-dismiss guard and flip it to the confirm state.
  await dialog.getByTestId("date-picker-display").fill(date);
  await dialog.getByLabel("Name").click();

  // Colour keeps the dialog's default (we assert the swatch paints whatever
  // colour was stored, not a specific value).
  await dialog.getByTestId("milestone-dialog-close").click();
  await expect(dialog).toHaveCount(0);
}

test.describe("roadmap milestone view", () => {
  test("milestone appears in the Milestone table (name/date/colour); name opens edit; List still renders", async ({
    page,
  }) => {
    const wsId = await signupOwner(page, uniqEmail("ms-own"));
    await createBoard(page); // milestones need a host board (milestone-as-card)

    await gotoWithRetry(page, `/w/${wsId}/roadmap`);
    await expect(page.getByTestId("roadmap-view")).toBeVisible();

    // All four view-mode buttons exist (the milestone tab sits after deliverable).
    await expect(page.getByTestId("roadmap-view-mode-gantt")).toBeVisible();
    await expect(page.getByTestId("roadmap-view-mode-list")).toBeVisible();
    await expect(page.getByTestId("roadmap-view-mode-deliverable")).toBeVisible();
    await expect(page.getByTestId("roadmap-view-mode-milestone")).toBeVisible();

    // Add a milestone from the always-on toolbar.
    await addMilestone(page, "Launch GA", "15/07/2026");

    // Switch to the Milestone view.
    await page.getByTestId("roadmap-view-mode-milestone").click();
    await expect(page.getByTestId("roadmap-milestone-view")).toBeVisible();
    // Active-state must follow the selection: Milestone on, List off.
    await expect(page.getByTestId("roadmap-view-mode-milestone")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("roadmap-view-mode-list")).toHaveAttribute(
      "data-active",
      "false",
    );

    // The milestone row shows name, date and colour swatch.
    const nameCell = page
      .getByTestId("roadmap-milestone-name")
      .filter({ hasText: "Launch GA" });
    await expect(nameCell).toBeVisible();
    const row = page
      .getByTestId("roadmap-milestone-row")
      .filter({ hasText: "Launch GA" });
    await expect(row).toContainText("15/07/2026");
    // The colour swatch paints exactly the milestone's stored colour.
    const swatch = row.getByTestId("roadmap-milestone-color");
    await expect(swatch).toBeVisible();
    const paint = await swatch.evaluate((el) => ({
      dataColor: el.getAttribute("data-color"),
      bg: getComputedStyle(el).backgroundColor,
    }));
    expect(paint.dataColor).toMatch(/^#[0-9a-f]{6}$/i);
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(paint.dataColor!.slice(i, i + 2), 16),
    );
    expect(paint.bg).toBe(`rgb(${r}, ${g}, ${b})`);

    // Clicking the milestone name opens the existing edit dialog.
    await nameCell.click();
    const editDialog = page.getByTestId("milestone-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Edit milestone")).toBeVisible();
    await page.keyboard.press("Escape");

    // List view still mounts after the generic-CardTable refactor (parity).
    // This workspace has no cards, so the List path renders its empty state
    // (returned by the same CardTable); either outcome proves it still works.
    // Populated-row parity is covered by roadmap-deliverable.spec.ts.
    await page.getByTestId("roadmap-view-mode-list").click();
    await expect(
      page
        .getByTestId("roadmap-list-view")
        .or(page.getByTestId("roadmap-list-empty")),
    ).toBeVisible();
  });
});
