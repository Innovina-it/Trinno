import { test, expect, type Page } from "@playwright/test";

// E2E coverage for the roadmap Deliverable view (the third view-mode tab next
// to Gantt / List). A "deliverable" is a non-archived card that carries a URL
// link. This spec is the test bed for that feature:
//   - the three view-mode buttons exist and switch,
//   - a linked card shows in the Deliverable table; an unlinked one does not,
//   - clicking the deliverable name opens the in-place quick-edit,
//   - the List view still renders (refactor parity — the Deliverable view
//     reuses the same CardTable the List view was rebuilt on).
//
// Harness (signup + board/card/link) mirrors links.spec.ts exactly.

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

async function createBoardWithCard(
  page: Page,
  wsId: string,
  boardTitle: string,
  cardTitle: string,
): Promise<void> {
  await gotoWithRetry(page, `/w/${wsId}/boards`);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);

  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill(boardTitle);
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: boardTitle })).toBeVisible();

  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  const col = page.locator("[data-list-id]").filter({ hasText: "Tasks" }).first();
  await expect(col).toBeVisible();

  await addCard(page, col, cardTitle);

  const url = new URL(page.url());
  url.searchParams.set("assignee", "all");
  await page.goto(url.toString());
  await expect(
    page.locator("[data-card-id]").filter({ hasText: cardTitle }),
  ).toBeVisible();
}

async function addCard(
  page: Page,
  col: ReturnType<Page["locator"]>,
  cardTitle: string,
) {
  await col.getByTestId("list-add-card").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("roadmap-new-card-title").fill(cardTitle);
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function addLinkToCard(page: Page, cardTitle: string, url: string) {
  const tile = page.locator("[data-card-id]").filter({ hasText: cardTitle }).first();
  await tile.click();
  await expect(page.getByTestId("card-quick-view")).toBeVisible();
  const icon = page.getByTestId("link-icon-card");
  await expect(icon).toBeVisible();
  await icon.click();
  await expect(page.getByTestId("link-edit-dialog")).toBeVisible();
  await page.getByTestId("link-url-input").fill(url);
  await expect(page.getByTestId("link-save")).toHaveText("Save");
  await page.getByTestId("link-save").click();
  await expect(icon).toHaveAttribute("data-haslink", "1");
  // Let the normalized server value commit before we navigate away.
  await page.waitForTimeout(1000);
  // Close the quick view.
  await page.keyboard.press("Escape").catch(() => {});
}

test.describe("roadmap deliverable view", () => {
  test("linked card appears as a deliverable; name opens quick-edit; List still renders", async ({
    page,
  }) => {
    const wsId = await signupOwner(page, uniqEmail("deliv-own"));
    await createBoardWithCard(page, wsId, "Deliv Board", "Linked deliverable");

    // Second card, intentionally WITHOUT a link — must NOT be a deliverable.
    const col = page.locator("[data-list-id]").filter({ hasText: "Tasks" }).first();
    await addCard(page, col, "Plain task");

    await addLinkToCard(page, "Linked deliverable", "drive.google.com/folder/deliv");

    // Go to the roadmap.
    await gotoWithRetry(page, `/w/${wsId}/roadmap`);
    await expect(page.getByTestId("roadmap-view")).toBeVisible();

    // All three view-mode buttons exist.
    await expect(page.getByTestId("roadmap-view-mode-gantt")).toBeVisible();
    await expect(page.getByTestId("roadmap-view-mode-list")).toBeVisible();
    await expect(page.getByTestId("roadmap-view-mode-deliverable")).toBeVisible();

    // List view still renders after the CardTable refactor (parity).
    await page.getByTestId("roadmap-view-mode-list").click();
    await expect(page.getByTestId("roadmap-list-view")).toBeVisible();

    // Switch to the Deliverable view.
    await page.getByTestId("roadmap-view-mode-deliverable").click();
    await expect(page.getByTestId("roadmap-deliverable-view")).toBeVisible();
    // Active-state must follow the selection: Deliverable on, List off.
    await expect(page.getByTestId("roadmap-view-mode-deliverable")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("roadmap-view-mode-list")).toHaveAttribute(
      "data-active",
      "false",
    );

    // Deliverables are grouped under a collapsible lane header (the board name).
    const laneHeader = page
      .getByTestId("roadmap-deliverable-row-group")
      .filter({ hasText: "Deliv Board" });
    await expect(laneHeader).toBeVisible();
    await expect(laneHeader).toHaveAttribute("data-collapsed", "false");

    // Collapsing the lane hides its deliverable rows; expanding restores them.
    const linkedRow = page
      .getByTestId("roadmap-deliverable-name")
      .filter({ hasText: "Linked deliverable" });
    await expect(linkedRow).toBeVisible();
    await laneHeader.getByRole("button").click();
    await expect(laneHeader).toHaveAttribute("data-collapsed", "true");
    await expect(linkedRow).toHaveCount(0);
    await laneHeader.getByRole("button").click();
    await expect(linkedRow).toBeVisible();

    // The linked card shows; the unlinked one does not.
    await expect(
      page.getByTestId("roadmap-deliverable-name").filter({ hasText: "Linked deliverable" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("roadmap-deliverable-name").filter({ hasText: "Plain task" }),
    ).toHaveCount(0);

    // Clicking the deliverable name opens the in-place quick-edit popup.
    await page
      .getByTestId("roadmap-deliverable-name")
      .filter({ hasText: "Linked deliverable" })
      .click();
    await expect(page.getByTestId("card-quick-view")).toBeVisible();
  });
});
