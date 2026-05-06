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
  const email = `lcd-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}

async function addList(page: Page, title: string) {
  // The form stays open after submit (clears title, keeps open state), so the
  // "+ Add a list" trigger button is only present on the very first invocation.
  const trigger = page.getByRole("button", { name: "+ Add a list" });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  await page.getByPlaceholder("List title").fill(title);
  await page.getByRole("button", { name: /^add list$/i }).click();
  // Wait until the new list column is rendered.
  await expect(
    page.locator(`[data-list-id]`).filter({ hasText: title }),
  ).toBeVisible();
}

async function addCardToList(page: Page, listTitle: string, cardTitle: string) {
  const column = page
    .locator("[data-list-id]")
    .filter({ hasText: listTitle })
    .first();
  // Card form also stays open after submit, so only click the trigger when
  // the textbox isn't already on screen.
  const trigger = column.getByRole("button", { name: "+ Add a card" });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  await column.getByPlaceholder("Card title").fill(cardTitle);
  await column.getByRole("button", { name: /^add$/i }).click();
  await expect(column.getByText(cardTitle)).toBeVisible();
}

async function dragCardToList(
  page: Page,
  cardId: string,
  targetListId: string,
) {
  // dnd-kit's PointerSensor needs a real pointer-down + small move (>= 4px,
  // configured in board-view.tsx) to "activate" before any motion is treated
  // as a drag. We also need to step slowly enough for dnd-kit to keep up,
  // otherwise the gesture finishes as a click and the CardTile <Link>
  // navigates to the card modal.
  //
  // We deliberately drop onto an empty area of the target list (just above
  // its AddCardForm trigger) rather than on top of another card-tile <Link>,
  // so the trailing mouse-up never lands on a navigable element.
  const handle = page.locator(`[data-card-id="${cardId}"]`);
  const target = page.locator(`[data-list-id="${targetListId}"]`);

  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error("missing bounding box for drag handle/target");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // Drop near the bottom-center of the target column (empty space above the
  // "+ Add a card" button). This is part of the list-drop droppable area.
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height - 40;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross the 4px activation distance so PointerSensor starts the drag.
  await page.mouse.move(startX + 5, startY, { steps: 5 });
  await page.mouse.move(startX + 12, startY + 4, { steps: 5 });
  // Give React a tick to mount the DragOverlay before the long sweep.
  await page.waitForTimeout(100);
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function getCardOrderInList(page: Page, listTitle: string) {
  const column = page
    .locator("[data-list-id]")
    .filter({ hasText: listTitle })
    .first();
  return column.locator("[data-card-id]").allTextContents();
}

test("list + card + drag lifecycle", async ({ page }) => {
  // 1. Sign up → default workspace.
  await signupAndLandOnDefaultWorkspace(page);
  // Workspace landing now redirects to /roadmap; visit /boards for the
  // new-board CTA.
  await page.getByTestId("nav-boards").click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);

  // 2. Create board "Roadmap". Step 1 picks the template (Blank by default
  // post Plan #16b-γ-B); step 2 fills Title + tone.
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill("Roadmap");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();

  // 3. Add list "To Do".
  await addList(page, "To Do");
  // 4. Add list "Done".
  await addList(page, "Done");

  // 5. + 6. Add two cards to "To Do".
  await addCardToList(page, "To Do", "First task");
  await addCardToList(page, "To Do", "Second task");

  // Sanity check before drag: both cards live in "To Do" in insertion order.
  const before = await getCardOrderInList(page, "To Do");
  expect(before).toEqual(["First task", "Second task"]);
  expect(await getCardOrderInList(page, "Done")).toEqual([]);

  // Resolve ids needed for the drag from data attributes.
  const todoColumn = page
    .locator("[data-list-id]")
    .filter({ hasText: "To Do" })
    .first();
  const doneColumn = page
    .locator("[data-list-id]")
    .filter({ hasText: "Done" })
    .first();
  const secondId = await todoColumn
    .locator("[data-card-id]")
    .filter({ hasText: "Second task" })
    .first()
    .getAttribute("data-card-id");
  const doneListId = await doneColumn.getAttribute("data-list-id");
  if (!secondId || !doneListId) throw new Error("missing data attribute");

  // 7. Drag "Second task" from "To Do" into "Done".
  // Wait for the server-action POST that the moveCard call kicks off so we
  // know the move was committed (not just optimistically applied) before we
  // reload — otherwise the in-flight request may be cancelled by navigation.
  const moveResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/b/"),
    { timeout: 10_000 },
  );
  await dragCardToList(page, secondId, doneListId);

  // Optimistic store update should land within a few hundred ms.
  await expect
    .poll(async () => (await getCardOrderInList(page, "Done")).join("|"), {
      timeout: 5000,
    })
    .toBe("Second task");
  expect(await getCardOrderInList(page, "To Do")).toEqual(["First task"]);

  // Wait for the server action to finish (and any RSC revalidation).
  await moveResponse;
  await page.waitForLoadState("networkidle");

  // 8. Reload — ordering must persist (server-side moveCard committed).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  expect(await getCardOrderInList(page, "To Do")).toEqual(["First task"]);
  expect(await getCardOrderInList(page, "Done")).toEqual(["Second task"]);
});
