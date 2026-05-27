import { test, expect, type Page, type Locator } from "@playwright/test";

// A roadmap bar that is past its target date AND still open (not completed)
// gets a red outline (--status-blocked), mirroring the due-pill overdue rule.
// "Closed" on the roadmap == completedAt set, so completed bars never flag.
//
// This spec drives a real seeded workspace: it edits one bar's dates into
// the past (overdue), then into the future (on-time), then completes an
// overdue bar — asserting the data-overdue flag and the inline borderColor
// override at each step.

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

async function signupSeeded(page: Page) {
  // Local signup rejects example.com; use @innovina.it. Seed checkbox stays
  // checked so the callback creates a workspace with demo boards + cards.
  const email = `ov-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}\/roadmap/, { timeout: 20_000 });
  // Let the seed's roadmap cards paint.
  await page.waitForTimeout(1500);
}

// Sets both start + target on the given bar via right-click → Edit dates.
async function setBarDates(page: Page, bar: Locator, start: Date, target: Date) {
  await bar.click({ button: "right" });
  await page.getByTestId("roadmap-bar-menu-edit-dates").click();
  const dialog = page.getByTestId("roadmap-bar-dates-dialog");
  await expect(dialog).toBeVisible();

  const startInput = page
    .getByTestId("roadmap-bar-dates-start")
    .getByTestId("date-picker-display");
  const targetInput = page
    .getByTestId("roadmap-bar-dates-target")
    .getByTestId("date-picker-display");

  await startInput.fill(ddmmyyyy(start));
  await targetInput.fill(ddmmyyyy(target));
  // Filling a field opens that picker's 640px calendar popover, which floats
  // down over the Save button. Dismiss it by clicking the dialog title
  // (outside the picker's wrapper) before saving.
  await page.getByRole("heading", { name: "Edit dates" }).click();
  await expect(page.getByRole("dialog", { name: "Pick date" })).toBeHidden();
  await page.getByTestId("roadmap-bar-dates-save").click();
  await expect(dialog).toBeHidden();
}

test("overdue + open bar gets a red border; on-time and completed do not", async ({
  page,
}) => {
  await signupSeeded(page);

  const firstBar = page.getByTestId("roadmap-bar").first();
  await expect(firstBar).toBeVisible();
  const cardId = await firstBar.getAttribute("data-card-id");
  expect(cardId).toBeTruthy();
  const bar = page.locator(
    `[data-testid="roadmap-bar"][data-card-id="${cardId}"]`,
  );

  // 1. Goal — push dates into the past on an open card → overdue → red border.
  await setBarDates(page, bar, daysFromNow(-30), daysFromNow(-10));
  await expect(bar).toHaveAttribute("data-overdue", "true", { timeout: 15_000 });
  await expect
    .poll(() => bar.evaluate((el: HTMLElement) => el.style.borderColor))
    .toContain("--status-blocked");

  // 2. MNC (on-time unchanged) — future target → not overdue → no red override.
  await setBarDates(page, bar, daysFromNow(5), daysFromNow(20));
  await expect(bar).toHaveAttribute("data-overdue", "false", { timeout: 15_000 });
  expect(await bar.evaluate((el: HTMLElement) => el.style.borderColor)).toBe("");

  // 3. MNC (closed never red) — overdue dates again, then complete it.
  await setBarDates(page, bar, daysFromNow(-30), daysFromNow(-10));
  await expect(bar).toHaveAttribute("data-overdue", "true", { timeout: 15_000 });
  await bar.getByTestId("roadmap-bar-complete-toggle").click();
  await expect(bar).toHaveAttribute("data-overdue", "false", { timeout: 15_000 });
  expect(await bar.evaluate((el: HTMLElement) => el.style.borderColor)).toBe("");
});
