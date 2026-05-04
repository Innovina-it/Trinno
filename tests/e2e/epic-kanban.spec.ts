import { test, expect, type Page } from "@playwright/test";

/**
 * Plan #epic-as-kanban Task 17 — E2E smoke for the epic-kanban view.
 *
 * Signup helper races on workspace-URL vs check-your-email so we work
 * with both `enable_confirmations=true` and `enable_confirmations=false`
 * Supabase configurations.
 */

const MAILPIT_API = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as {
        messages: Array<{ ID: string }>;
      };
      if (body.messages && body.messages.length > 0) {
        const id = body.messages[0].ID;
        const detail = await (
          await fetch(`${MAILPIT_API}/api/v1/message/${id}`)
        ).json();
        const text: string = detail.HTML || detail.Text || "";
        const m =
          text.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ??
          text.match(/(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email arrived for ${email}`);
}

async function signupSeedAndLand(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  // Demo-seed checkbox is checked by default; leave it.
  await page.getByRole("button", { name: /sign up/i }).click();

  // Two paths after submit:
  //   (a) auto-confirm enabled → router.replace('/auth/callback') → /w/{id}/roadmap
  //   (b) confirmation required → "Check your email" page → fetch confirm link → /w/{id}/...
  await Promise.race([
    page.waitForURL(/\/w\/[0-9a-f-]{36}/, { timeout: 15_000 }),
    page
      .getByText(/check your email/i)
      .waitFor({ state: "visible", timeout: 15_000 }),
  ]);

  if (!/\/w\/[0-9a-f-]{36}/.test(page.url())) {
    const link = await fetchConfirmLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 15_000 });
  }

  // Wait for the demo seed to finish — the seed creates the demo data.
  // Roadmap is the workspace landing; wait for it to render at least one
  // lane (the seeded epic gives us this).
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/roadmap$/, {
    timeout: 15_000,
  });
  const url = page.url();
  const wsMatch = url.match(/\/w\/([0-9a-f-]{36})/);
  if (!wsMatch) throw new Error(`no workspace in url: ${url}`);
  return { email, workspaceId: wsMatch[1] };
}

test("epic-kanban: drag a child from todo to done, persists across reload", async ({
  page,
}) => {
  await signupSeedAndLand(page, "epic-kanban");

  // Roadmap is the landing.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/roadmap$/);

  // First-run tour overlay obscures lane controls — dismiss it.
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /^skip$/i }).click();
    await expect(tour).toBeHidden({ timeout: 5_000 });
  }

  // Click the first epic-lane header link → routes to epic-kanban.
  const epicLink = page.getByTestId("lane-epic-header-link").first();
  await epicLink.waitFor({ state: "visible", timeout: 10_000 });
  await epicLink.click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/e\/[0-9a-f-]{36}/);

  // 5 status columns visible.
  for (const sk of ["todo", "in_progress", "review", "done", "blocked"]) {
    await expect(page.getByTestId(`epic-col-${sk}`)).toBeVisible();
  }

  // Find a card in any non-empty status column and drag to done.
  // The demo seed places the epic's only direct child (the story) on the
  // "This sprint" list whose status_kind is null → it appears in the
  // optional "unmapped" column. Scroll the source tile + the done column
  // into view so both have valid screen coordinates for the drag.
  const sourceCol = page
    .locator('[data-testid^="epic-col-"]')
    .filter({ has: page.locator("[data-card-id]") })
    .first();
  await sourceCol.scrollIntoViewIfNeeded();
  const tile = sourceCol.locator("[data-card-id]").first();
  const tileId = await tile.getAttribute("data-card-id");
  expect(tileId).toBeTruthy();

  const doneCol = page.getByTestId("epic-col-done");
  const tileBox = await tile.boundingBox();
  if (!tileBox) throw new Error("source tile not visible");
  const startX = tileBox.x + tileBox.width / 2;
  const startY = tileBox.y + tileBox.height / 2;

  // The 5-status board is wider than the viewport. Press on the source
  // tile, then sweep left far enough that @dnd-kit's autoscroll brings
  // the DONE column into the viewport on its own. We keep moving until
  // the column is visible, then release in its center. The PointerSensor
  // has activationConstraint.distance = 8 so the first move must cross
  // 8px to activate.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 10, startY, { steps: 5 });
  await page.mouse.move(startX - 18, startY + 6, { steps: 5 });
  await page.waitForTimeout(100);

  // Sweep towards the left edge in increments to give @dnd-kit time to
  // autoscroll the kanban container.
  for (let x = startX - 50; x > 60; x -= 80) {
    await page.mouse.move(x, startY, { steps: 6 });
    await page.waitForTimeout(80);
    const box = await doneCol.boundingBox().catch(() => null);
    if (box && box.x >= 0 && box.x + box.width <= 1280) {
      break;
    }
  }

  const doneBox = await doneCol.boundingBox();
  if (!doneBox) throw new Error("done column not visible after sweep");
  await page.mouse.move(
    doneBox.x + doneBox.width / 2,
    doneBox.y + doneBox.height / 2,
    { steps: 12 },
  );
  await page.waitForTimeout(100);
  await page.mouse.up();

  // Card is now under done (optimistic).
  await expect(
    doneCol.locator(`[data-card-id="${tileId}"]`),
  ).toBeVisible({ timeout: 5_000 });

  // The drag-end handler's `await moveCardToStatus` runs async after
  // mouse.up returns. Give the server action time to commit before we
  // reload — otherwise SSR re-reads stale DB state.
  await page.waitForTimeout(800);

  // Reload — assertion still holds.
  await page.reload();
  await expect(
    page.getByTestId("epic-col-done").locator(`[data-card-id="${tileId}"]`),
  ).toBeVisible({ timeout: 10_000 });
});
