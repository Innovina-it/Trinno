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

async function signupAndConfirm(page: Page, email: string) {
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
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Escape");
  if ((await page.getByRole("dialog").count()) > 0) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 });
}

test("watchers, mentions, inbox, time tracking, dashboards", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailA = `jca-${stamp}@example.com`;
  const emailB = `jcb-${stamp}@example.com`;
  const localPartB = emailB.split("@")[0];

  // 1. Sign up user A. Create board with one card "Bug X".
  await signupAndConfirm(a, emailA);
  const wsUrlA = a.url();
  const wsIdA = wsUrlA.match(/\/w\/([0-9a-f-]{36})/)![1];

  await a.getByRole("button", { name: /new board/i }).click();
  await a.getByLabel("Title").fill("Collab");
  await a.getByRole("button", { name: /create board/i }).click();
  await expect(a).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = a.url();

  await addList(a, "To do");
  await addCardToList(a, "To do", "Bug X");

  // 2. Open Bug X → click Watch toggle. Should toggle from WATCH → WATCHING.
  await openCardModal(a, "Bug X");
  // The watch toggle initial state is fetched async; wait for the WATCH button.
  await expect(
    a.getByRole("button", { name: /^WATCH$/ }),
  ).toBeVisible({ timeout: 5000 });
  await a.getByRole("button", { name: /^WATCH$/ }).click();
  await expect(
    a.getByRole("button", { name: /WATCHING/ }),
  ).toBeVisible({ timeout: 5000 });
  await closeCardModal(a);

  // 3. Re-open → still watching.
  await openCardModal(a, "Bug X");
  await expect(
    a.getByRole("button", { name: /WATCHING/ }),
  ).toBeVisible({ timeout: 5000 });
  await closeCardModal(a);

  // 4. User B signs up in a separate context.
  await signupAndConfirm(b, emailB);
  // User A invites B to A's workspace.
  await a.goto(`/w/${wsIdA}/settings`);
  await a.locator("#invite-email").fill(emailB);
  await a.getByRole("button", { name: /^Invite$/ }).click();
  // Invited member appears in the member list (display name = email local-part).
  await expect(a.getByText(localPartB).first()).toBeVisible({ timeout: 5000 });

  // B navigates directly to the board URL — workspace-scoped boards are visible
  // to workspace members.
  await b.goto(boardUrl);
  await expect(b.getByRole("heading", { name: "Collab" })).toBeVisible({
    timeout: 5000,
  });
  // Give B's notification subscription a moment to attach.
  await b.waitForTimeout(750);

  // 5. User A posts a comment with @mention of B's display_name (local-part).
  await a.goto(boardUrl);
  await openCardModal(a, "Bug X");
  const commentsSection = a.getByTestId("comments-section");
  await commentsSection
    .getByLabel("New comment")
    .fill(`Hey @${localPartB} this is for you`);
  await commentsSection.getByRole("button", { name: /^save$/i }).click();
  await expect(
    commentsSection
      .locator("[data-comment-id]")
      .filter({ hasText: "this is for you" }),
  ).toBeVisible({ timeout: 5000 });

  // Within ~10s, B's notification bell should show unread count. Realtime CDC
  // delivers asynchronously; if the postgres_changes channel hasn't fired yet,
  // refreshing B's page forces the bell to re-fetch /api/notifications/recent
  // on mount which is a deterministic fallback.
  let unreadVisible = false;
  for (let i = 0; i < 5; i++) {
    if (
      await b
        .getByRole("button", { name: /Notifications.*\d+/ })
        .isVisible()
        .catch(() => false)
    ) {
      unreadVisible = true;
      break;
    }
    await b.waitForTimeout(1000);
  }
  if (!unreadVisible) {
    // Force a refetch by reloading.
    await b.reload();
  }
  await expect(
    b.getByRole("button", { name: /Notifications.*\d+/ }),
  ).toBeVisible({ timeout: 10_000 });

  // 6. B clicks bell → mention shows up. Click the mention → navigates to card.
  await b.getByRole("button", { name: /Notifications/ }).click();
  // Dropdown shows the inbox list with the new mention.
  await expect(
    b.getByText(/mentioned you in/i).first(),
  ).toBeVisible({ timeout: 5000 });
  // Close the dropdown by pressing Escape (clicking the link would navigate).
  await b.keyboard.press("Escape");

  // Click "INBOX" link via /inbox direct nav (BACKLOG/INBOX nav links only show
  // on /w/ paths; the bell dropdown's "VIEW ALL" link is the documented path).
  await b.goto("/inbox");
  await expect(b.getByRole("heading", { name: /Inbox/ })).toBeVisible();
  await expect(b.getByText(/mentioned you in/i).first()).toBeVisible({
    timeout: 5000,
  });

  // 7. B marks notification as read. Bell count goes to 0.
  await b.getByRole("button", { name: /MARK READ/i }).first().click();
  await expect
    .poll(
      async () => {
        // After marking read, the bell aria-label drops the "(N unread)" suffix.
        const bell = b.getByRole("button", { name: /^Notifications$/ });
        return await bell.count();
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);

  // 8. Open card modal — set estimate=60 minutes + add worklog of 30m.
  await a.goto(boardUrl);
  await openCardModal(a, "Bug X");
  const timeSection = a.getByTestId("time-section");
  await timeSection.getByLabel(/Estimate/).fill("60");
  await timeSection.getByRole("button", { name: /^SAVE$/ }).click();
  await a.waitForTimeout(400);
  // Log work of 30 minutes.
  await timeSection.getByRole("button", { name: /Log work/ }).click();
  await timeSection.getByLabel("Minutes").fill("30");
  await timeSection.getByRole("button", { name: /^LOG$/ }).click();
  await a.waitForTimeout(400);
  await closeCardModal(a);

  // Reload board → tile shows the time-chip "30/60m".
  await a.goto(boardUrl);
  const tile = a
    .locator("[data-card-id]")
    .filter({ hasText: "Bug X" })
    .first();
  await expect(tile.getByTestId("tile-time")).toContainText("30/60m", {
    timeout: 5000,
  });

  // 9. User A creates a personal dashboard via /dashboards.
  await a.goto("/dashboards");
  await a.getByTestId("new-dashboard-btn").click();
  await a.locator("#dash-name").fill("My deck");
  await a.getByRole("button", { name: /^create$/i }).click();
  await expect(a).toHaveURL(/\/dashboards\/[0-9a-f-]{36}/);

  // 10. Add a "count" gadget with what="open_cards", scope=personal (no workspace).
  await a.getByTestId("add-gadget-btn").click();
  // Type defaults to count, what defaults to open_cards. Clear workspace selector
  // (the optional one) so the count is across all the user's workspaces.
  await a.locator("#gad-ws-opt").selectOption("");
  await a.getByRole("button", { name: /^add gadget$/i }).click();
  // The gadget renders a big tabular number.
  await expect(a.getByTestId("gadget-count-value")).toBeVisible({
    timeout: 5000,
  });

  // 11. Add a "markdown_note" gadget.
  await a.getByTestId("add-gadget-btn").click();
  await a.locator("#gad-type").selectOption("markdown_note");
  await a
    .locator("#gad-body")
    .fill("# Hello\n**bold**");
  await a.getByRole("button", { name: /^add gadget$/i }).click();
  // Heading + bold render as <h2> + <strong>.
  const md = a.getByTestId("gadget-markdown").first();
  await expect(md).toBeVisible({ timeout: 5000 });
  await expect(md.locator("h2")).toContainText("Hello");
  await expect(md.locator("strong")).toContainText("bold");

  // 12. Move the markdown gadget up — its position should swap with the count.
  // Capture initial gadget IDs in DOM order.
  const initialOrder = await a
    .locator('[data-testid="gadget"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-gadget-id")));
  expect(initialOrder.length).toBe(2);

  // Open the actions menu of the second (markdown) gadget and click "Move up".
  await a
    .locator('[data-testid="gadget"]')
    .nth(1)
    .getByTestId("gadget-actions-trigger")
    .click();
  await a.getByRole("menuitem", { name: /Move up/ }).click();

  await expect
    .poll(
      async () =>
        a
          .locator('[data-testid="gadget"]')
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("data-gadget-id")),
          ),
      { timeout: 5000 },
    )
    .toEqual([initialOrder[1], initialOrder[0]]);

  await ctxA.close();
  await ctxB.close();
});
