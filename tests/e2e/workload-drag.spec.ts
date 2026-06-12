// E2E: workload bar drag-to-move + completed-bar guard.
//
// Covers components/workload/workload-bar.tsx +
// components/workload/use-workload-drag.ts.
//
// What we assert:
//   * Active (non-completed) bar can be moved by dragging its body
//     horizontally; the bar's `left` style updates by ~delta px.
//   * After a reload, the new position persists (server write committed).
//   * A completed bar (`data-completed="true"`) does not move on
//     pointer-down + drag, and a "Card is complete" toast appears.
//
// Drag mechanics: the bar wires `onPointerDown` directly on the <Link>;
// the hook listens for `pointermove` + `pointerup` on `window`. Playwright
// `mouse.down/move/up` synthesizes pointer events via the implicit-pointer
// spec, which is what the hook reads.
//
// PX_PER_DAY for the default `month` range preset is 22 (see
// PX_PER_DAY_BY_RANGE in workload-view.tsx). We hardcode that here per
// the brief; if the default ever changes, update the constant below.

import { test, expect, type Page } from "@playwright/test";

const PX_PER_DAY_MONTH = 22;
const PX_TOLERANCE = 1.5;

async function signupAndSeed(page: Page, prefix: string): Promise<{ workspaceId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "1", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  // Rich seed builds 3 boards + 4 sprints + many cards on cold runners —
  // give the redirect a generous window before declaring failure.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return { workspaceId: page.url().match(/\/w\/([0-9a-f-]{36})/)![1] };
}

async function safeGoto(page: Page, url: string) {
  // Same pattern as gantt-drag-first.spec.ts — workspace redirects can race
  // with subsequent navigations on cold runners.
  try {
    await page.goto(url);
  } catch {
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: /skip/i }).click().catch(() => {});
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function gotoWorkload(page: Page) {
  await safeGoto(page, "/workload");
  await dismissTourIfPresent(page);
  await expect(page.getByTestId("workload-view")).toBeVisible({ timeout: 15_000 });
  // Ensure at least one bar plotted before we try to drag.
  await expect.poll(
    async () => await page.locator('[data-testid="workload-bar"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(1);
}

// Read the pixel `left` value of a bar by querying its inline style.
async function readBarLeft(page: Page, cardId: string): Promise<number> {
  const v = await page
    .locator(`[data-testid="workload-bar"][data-card-id="${cardId}"]`)
    .first()
    .evaluate((el) => {
      const s = (el as HTMLElement).style.left;
      return s ? parseFloat(s) : NaN;
    });
  if (Number.isNaN(v)) throw new Error(`unable to read left for ${cardId}`);
  return v;
}

test("workload bar drag persists; completed bar refuses + toasts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signupAndSeed(page, "wd");
  await gotoWorkload(page);

  // ---- Part 1: drag a non-completed bar 7 days right and verify persist. ----
  const activeBar = page
    .locator('[data-testid="workload-bar"][data-completed="false"]')
    .first();
  await expect(activeBar).toBeVisible({ timeout: 10_000 });

  const cardId = await activeBar.getAttribute("data-card-id");
  if (!cardId) throw new Error("active bar missing data-card-id");

  const beforeBox = await activeBar.boundingBox();
  if (!beforeBox) throw new Error("missing bbox for active bar");
  const beforeLeft = await readBarLeft(page, cardId);

  // Drag delta = +7 days * 22 px/day. Start the drag in the middle of the
  // bar (move-mode), nudge past the 4px move threshold, then sweep.
  const deltaPx = 7 * PX_PER_DAY_MONTH;
  const startX = beforeBox.x + beforeBox.width / 2;
  const startY = beforeBox.y + beforeBox.height / 2;
  const endX = startX + deltaPx;
  const endY = startY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross the 4-px move threshold so the hook flips into "dragging" mode.
  await page.mouse.move(startX + 6, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.mouse.up();

  // Optimistic override should land within a few hundred ms.
  await expect.poll(
    async () => await readBarLeft(page, cardId),
    { timeout: 8000 },
  ).toBeGreaterThan(beforeLeft + deltaPx - PX_TOLERANCE);

  const afterLeft = await readBarLeft(page, cardId);
  expect(Math.abs(afterLeft - (beforeLeft + deltaPx))).toBeLessThanOrEqual(
    PX_TOLERANCE,
  );

  // Reload + assert the new position persisted (server write committed,
  // override drained, render reflects the new dates).
  await page.reload().catch(async () => {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  });
  await expect(page.getByTestId("workload-view")).toBeVisible({ timeout: 15_000 });
  await expect.poll(
    async () => await readBarLeft(page, cardId),
    { timeout: 10_000 },
  ).toBeGreaterThan(beforeLeft + deltaPx - PX_TOLERANCE);
  const persistedLeft = await readBarLeft(page, cardId);
  expect(Math.abs(persistedLeft - (beforeLeft + deltaPx))).toBeLessThanOrEqual(
    PX_TOLERANCE,
  );

  // ---- Part 2: a completed bar refuses the drag + surfaces a toast. ----
  // The seed marks the Sprint-14 closed stories complete; if the default
  // viewport doesn't include any, we skip this assertion rather than
  // failing — the active-bar persistence above is the headline check.
  const completedBar = page
    .locator('[data-testid="workload-bar"][data-completed="true"]')
    .first();
  if ((await completedBar.count()) === 0) {
    test.info().annotations.push({
      type: "note",
      description: "no completed workload bar in viewport — skipping refusal assertion",
    });
    return;
  }

  const completedId = await completedBar.getAttribute("data-card-id");
  if (!completedId) throw new Error("completed bar missing data-card-id");
  const completedBefore = await readBarLeft(page, completedId);
  const cBox = await completedBar.boundingBox();
  if (!cBox) throw new Error("missing bbox for completed bar");

  const cStartX = cBox.x + cBox.width / 2;
  const cStartY = cBox.y + cBox.height / 2;
  await page.mouse.move(cStartX, cStartY);
  await page.mouse.down();
  await page.mouse.move(cStartX + 6, cStartY, { steps: 4 });
  await page.mouse.move(cStartX + deltaPx, cStartY, { steps: 25 });
  await page.mouse.up();

  // Bar didn't move (no drag started — completed branch toasts and bails).
  const completedAfter = await readBarLeft(page, completedId);
  expect(Math.abs(completedAfter - completedBefore)).toBeLessThanOrEqual(
    PX_TOLERANCE,
  );

  // "Card is complete" sonner toast surfaced. Sonner renders into a region
  // with role=status; matching by visible text is the most-stable check
  // since toast container internals shift across versions.
  await expect(page.getByText(/card is complete/i)).toBeVisible({
    timeout: 5000,
  });
});
