import { test, expect, type Page } from "@playwright/test";

async function signupAndConfirm(page: Page, email: string) {
  await page.context().addCookies([{ name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" }]);
    await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
}


test("user A creates a list → user B sees it within 3 s", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailA = `rta-${stamp}@innovina.it`;
  const emailB = `rtb-${stamp}@innovina.it`;
  // Display name is the email's local-part (see migration 0002_profile_trigger.sql).
  const localPartB = emailB.split("@")[0];

  await signupAndConfirm(a, emailA);
  await signupAndConfirm(b, emailB);

  // Workspace landing redirects to /roadmap; visit /boards for the new-board CTA.
  await a.getByTestId("nav-boards").click();
  await expect(a).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);

  // A creates board in their default workspace
  await a.getByRole("button", { name: /new board/i }).click();
  await a.getByRole("button", { name: /^continue$/i }).click();
  await a.getByLabel("Title").fill("Realtime");
  await a.getByRole("button", { name: /create board/i }).click();
  await expect(a).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = a.url();

  // Navigate back to A's workspace to invite B as a workspace member.
  await a.getByRole("link", { name: "Trinno home" }).click();
  await expect(a).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  const wsUrl = a.url();
  await a.goto(wsUrl + "/settings");
  await a.getByLabel("Email").fill(emailB);
  await a.getByRole("button", { name: /^invite$/i }).click();
  // The invited member's display name (local-part) appears in the member list.
  await expect(a.getByText(localPartB)).toBeVisible();

  // B navigates to the board (workspace-visible, so SELECT works for ws members).
  await b.goto(boardUrl);
  await expect(b.getByRole("heading", { name: "Realtime" })).toBeVisible();
  // Give B's realtime channel a beat to subscribe.
  await b.waitForTimeout(750);

  // A goes back to the board and creates a list.
  await a.goto(boardUrl);
  await expect(a.getByRole("heading", { name: "Realtime" })).toBeVisible();
  await a.getByRole("button", { name: "+ Add a list" }).click();
  await a.getByPlaceholder("List title").fill("Sync me");
  await a.getByRole("button", { name: /^add list$/i }).click();
  // A sees the list optimistically.
  await expect(
    a.locator("[data-list-id]").filter({ hasText: "Sync me" }),
  ).toBeVisible();

  // B should see the new list within ~3 s via the postgres_changes CDC stream.
  await expect(
    b.locator("[data-list-id]").filter({ hasText: "Sync me" }),
  ).toBeVisible({ timeout: 5000 });

  await ctxA.close();
  await ctxB.close();
});
