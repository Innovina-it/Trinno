import { test, expect, type Page } from "@playwright/test";

// E2E for the Deliverable view's editable Open/Done status column.
//   - the status cell is a dropdown (Open/Done),
//   - selecting Done re-files the card into the board's 'done' list,
//   - selecting Open again reverts the card to the list it was in BEFORE
//     (pre_done_list_id) — the round-trip the user asked for.
//
// Harness (signup + board/card/link) mirrors roadmap-deliverable.spec.ts.

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

  await col.getByTestId("list-add-card").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("roadmap-new-card-title").fill(cardTitle);
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const url = new URL(page.url());
  url.searchParams.set("assignee", "all");
  await page.goto(url.toString());
  await expect(
    page.locator("[data-card-id]").filter({ hasText: cardTitle }),
  ).toBeVisible();
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
  await page.getByTestId("link-save").click();
  await expect(icon).toHaveAttribute("data-haslink", "1");
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape").catch(() => {});
}

/** Open the roadmap Deliverable view for a workspace. */
async function gotoDeliverableView(page: Page, wsId: string) {
  await gotoWithRetry(page, `/w/${wsId}/roadmap`);
  await expect(page.getByTestId("roadmap-view")).toBeVisible();
  await page.getByTestId("roadmap-view-mode-deliverable").click();
  await expect(page.getByTestId("roadmap-deliverable-view")).toBeVisible();
}

/** Assert which board list the card tile currently sits under. */
async function expectCardInList(
  page: Page,
  wsId: string,
  boardUrl: string,
  listTitle: string,
  cardTitle: string,
) {
  const url = new URL(boardUrl);
  url.searchParams.set("assignee", "all");
  await gotoWithRetry(page, url.toString());
  const col = page
    .locator("[data-list-id]")
    .filter({ hasText: listTitle })
    .first();
  await expect(
    col.locator("[data-card-id]").filter({ hasText: cardTitle }),
  ).toBeVisible();
}

test.describe("deliverable Open/Done status", () => {
  test("Done re-files to the done list; Open reverts to the previous list", async ({
    page,
  }) => {
    const wsId = await signupOwner(page, uniqEmail("deliv-status"));
    await createBoardWithCard(page, wsId, "Status Board", "Round-trip deliverable");
    const boardUrl = page.url();

    await addLinkToCard(page, "Round-trip deliverable", "drive.google.com/folder/rt");

    // Deliverable view: the status cell is the Open/Done dropdown, starting Open.
    await gotoDeliverableView(page, wsId);
    const select = page.getByTestId("deliverable-open-done");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("open");

    // Select Done → card re-files into the board's 'done' list.
    await select.selectOption("done");
    await expect(select).toHaveValue("done");
    await page.waitForTimeout(2000); // let the move + CDC settle
    await expectCardInList(page, wsId, boardUrl, "Done", "Round-trip deliverable");

    // Back to the deliverable view → select Open → card reverts to "Tasks".
    await gotoDeliverableView(page, wsId);
    const select2 = page.getByTestId("deliverable-open-done");
    await expect(select2).toHaveValue("done");
    await select2.selectOption("open");
    await expect(select2).toHaveValue("open");
    await page.waitForTimeout(2000);
    await expectCardInList(page, wsId, boardUrl, "Tasks", "Round-trip deliverable");
  });
});
