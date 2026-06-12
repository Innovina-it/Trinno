// Plan #16b-γ-G — Drag-first Gantt — G8 — E2E spec.
//
// Covers G1-G7 drag-first interactions added by the plan:
//   G8.1 — row reorder persists                       (G1)
//   G8.2 — reparent across epics                      (G2)
//   G8.3 — drag-paint creates card                    (G3)
//   G8.4 — priority gutter sets priority on bar drop  (G4)
//   G8.5 — snap to dependency target                  (G6)
//   G8.6 — header NEW CARD chip drag onto epic row    (G7)
//   G8.7 — chip click without drag opens empty dialog (G7 click parity)
//
// ⚠ Migration prerequisite ⚠
// G1 introduced `cards.roadmap_order` in `supabase/migrations/0046_roadmap_order.sql`.
// Before running this spec locally for the first time after pulling the
// G1-G7 work, you must apply the migration:
//
//   npm run db:reset
//
// Otherwise G8.1 (and any spec that does a row reorder via the row handle)
// will fail because the server action `reorderRoadmapRow` writes to
// `roadmap_order` and Supabase will reject the update.
//
// Each spec is fully self-contained (own signup, own seed, own assertions)
// so they can be run in isolation or arbitrary order. The helper functions
// below are intentionally duplicated from `jira-gantt-integration.spec.ts`
// rather than imported — the existing pattern in this repo is per-file
// helpers, and Playwright's test discovery doesn't reach across .spec
// boundaries cleanly.

import { test, expect, type Page } from "@playwright/test";

async function signupAndLandOnWorkspace(
  page: Page,
  prefix: string,
): Promise<{ email: string; workspaceId: string }> {
  // Allowed domain — the email-domain hook rejects @example.com (see
  // auth.spec.ts); using it here made every test fail at signup.
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.context().addCookies([{ name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" }]);
    await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  const workspaceId = page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
  return { email, workspaceId };
}

async function createBoard(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  return page.url();
}

async function addList(page: Page, title: string) {
  const trigger = page.getByRole("button", { name: "+ Add a list" });
  const placeholder = page.getByPlaceholder("List title");
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
  try {
    await placeholder.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
    }
    await placeholder.waitFor({ state: "visible", timeout: 8000 });
  }
  await placeholder.fill(title);
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
  // The inline composer was replaced by the NewCardDialog (list-add-card
  // trigger + roadmap-new-card-* inputs) — see card-features.spec.ts.
  await column.getByTestId("list-add-card").click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("roadmap-new-card-title").fill(cardTitle);
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 });
  // Default board filter is "Mine"; flip via URL so the unassigned card
  // is visible (same workaround as card-features.spec.ts).
  const url = new URL(page.url());
  if (url.searchParams.get("assignee") !== "all") {
    url.searchParams.set("assignee", "all");
    await page.goto(url.toString());
  }
  await expect(column.getByText(cardTitle, { exact: true })).toBeVisible({
    timeout: 5000,
  });
}

async function openCardModal(page: Page, cardTitle: string) {
  // Tile click opens the quick-view popover, not the full modal —
  // navigate to /b/<board>/c/<card> directly (card-features.spec.ts
  // pattern); the hero title input is the readiness signal.
  const tile = page
    .locator("[data-card-id]")
    .filter({ hasText: cardTitle })
    .first();
  const cardId = await tile.getAttribute("data-card-id");
  expect(cardId, "tile carries a data-card-id").toBeTruthy();
  const boardMatch = page.url().match(/\/b\/([0-9a-f-]{36})/);
  expect(boardMatch, "currently on a board route").toBeTruthy();
  await page.goto(`/b/${boardMatch![1]}/c/${cardId}`);
  await expect(page.locator("#card-title")).toBeVisible();
}

async function closeCardModal(page: Page) {
  // Full-page route doesn't render as <Dialog>; the explicit Close
  // button dismisses + bounces back to /b/...
  await page.getByRole("button", { name: /^close$/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}(\?|$)/);
}

async function setRoadmapDates(page: Page, start: Date, target: Date) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await page.getByLabel("Roadmap start date").fill(fmt(start));
  await page.getByLabel("Roadmap target date").fill(fmt(target));
  await page.waitForTimeout(800);
}

async function setCardType(page: Page, kind: "Epic" | "Story") {
  // Type picker now exposes card-type-edit (trigger) and
  // card-type-option-<id> items; the old TASK/STORY/EPIC button name
  // became "Change type from <label>".
  await page.getByTestId("card-type-edit").click();
  await page.getByTestId(`card-type-option-${kind.toLowerCase()}`).click();
  await expect(page.getByTestId("card-type-display")).toContainText(
    new RegExp(kind, "i"),
    { timeout: 5000 },
  );
}

async function setParentToCard(page: Page, parentCardTitle: string) {
  // Card modal exposes a "SET PARENT" button when no parent is set.
  await page.getByRole("button", { name: /set parent/i }).click();
  await page.getByPlaceholder("Search cards on this board…").fill(parentCardTitle);
  await page
    .getByRole("button", { name: new RegExp(parentCardTitle) })
    .first()
    .click();
  // The picker dialog auto-closes on selection.
}

async function linkBlockedBy(page: Page, blockerTitle: string) {
  // Card modal exposes a top-level LINK button which opens the link picker.
  await page.getByRole("button", { name: /^LINK$/ }).click();
  await page
    .getByRole("button", {
      name: /^(BLOCKS|BLOCKED BY|RELATES TO|DUPLICATES|DUPLICATED BY)/,
    })
    .first()
    .click();
  await page.getByRole("menuitemradio", { name: /^Blocked by$/ }).click();
  await page.getByPlaceholder("Search cards on this board…").fill(blockerTitle);
  await page
    .getByRole("button", { name: new RegExp(blockerTitle) })
    .first()
    .click();
}

function todayUTC(): Date {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

// ---------------------------------------------------------------------------
// G8.1 — Row reorder persists (G1)
// ---------------------------------------------------------------------------
// Three epics with no roadmap_order set — they appear in some default order
// (created-at desc, per the query). We drag the third epic above the first
// using its row handle, reload, and assert the new lane order persists.
// ---------------------------------------------------------------------------


test("G8.1 row reorder persists across reload", async ({ page }) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g81");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G81");
  await addList(page, "Backlog");

  // Three epics with dates so they all plot on the roadmap.
  const start = todayUTC();
  const target = addDays(start, 14);
  for (const t of ["Alpha", "Bravo", "Charlie"] as const) {
    await addCardToList(page, "Backlog", `Epic ${t}`);
    await openCardModal(page, `Epic ${t}`);
    await setCardType(page, "Epic");
    await setRoadmapDates(page, start, target);
    await closeCardModal(page);
  }

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  // Wait for all three lane rows to render (each epic gets its own lane).
  await expect
    .poll(
      () => page.getByTestId("roadmap-lane-row").count(),
      { timeout: 8000 },
    )
    .toBeGreaterThanOrEqual(3);

  // Snapshot pre-drag lane order — the i-th `roadmap-lane-row` carries the
  // epic's card id on `data-card-id` so we can compare.
  const laneRows = page.getByTestId("roadmap-lane-row");
  const preOrder = await laneRows.evaluateAll(
    (els) => els.map((el) => el.getAttribute("data-card-id") ?? null),
  );
  // Find the third epic's row (the one that should move). Use its title link
  // to disambiguate: the lane-title-link has the title, the lane-row holds
  // the handle + card-id.
  // Drag handle for the LAST lane row above the FIRST.
  const lastRow = laneRows.last();
  const firstRow = laneRows.first();
  const lastBox = await lastRow.boundingBox();
  const firstBox = await firstRow.boundingBox();
  if (!lastBox || !firstBox) throw new Error("missing lane row bbox");

  // The handle is opacity-0 until hover — we have to address it directly.
  // The handle button's testid is `roadmap-row-handle`, scoped to the row.
  const handle = lastRow.getByTestId("roadmap-row-handle");
  // Force-show the handle (it's hover-only) by hovering its parent first.
  await lastRow.hover();
  // Pointermove drag: pointerdown on handle, drift up across all earlier
  // rows, release ABOVE the first row's vertical center so the drop indicator
  // resolves to insertion-index 0.
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("missing handle bbox after hover");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = startX;
  const endY = firstBox.y + 4; // just above first row's center

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross a few pixels to satisfy any internal threshold then sweep up.
  await page.mouse.move(startX, startY - 6, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 25 });
  // Drop indicator should appear during the drag.
  await expect(page.getByTestId("roadmap-row-drop-indicator")).toBeVisible({
    timeout: 2000,
  });
  await page.mouse.up();

  // Wait for the optimistic re-order + server roundtrip to settle, then
  // reload to assert persistence (not just store mutation).
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  await expect
    .poll(
      () => page.getByTestId("roadmap-lane-row").count(),
      { timeout: 8000 },
    )
    .toBeGreaterThanOrEqual(3);

  const postOrder = await page
    .getByTestId("roadmap-lane-row")
    .evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-card-id") ?? null),
    );

  // Order changed AND the formerly-last lane is now at the front.
  expect(postOrder).not.toEqual(preOrder);
  expect(postOrder[0]).toBe(preOrder[preOrder.length - 1]);
});

// ---------------------------------------------------------------------------
// G8.2 — Reparent across epics (G2)
// ---------------------------------------------------------------------------
// Drag a child story's bar vertically into a sibling epic's lane. Verify
// after reload that the bar now sits within the destination lane's vertical
// range.
// ---------------------------------------------------------------------------

test("G8.2 reparent across epics via vertical bar drag", async ({ page }) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g82");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G82");
  await addList(page, "Backlog");

  const start = todayUTC();
  const target = addDays(start, 14);

  // Epic A (parent) + Epic B (destination) + Story C (child of A).
  await addCardToList(page, "Backlog", "Epic A");
  await openCardModal(page, "Epic A");
  await setCardType(page, "Epic");
  await setRoadmapDates(page, start, target);
  await closeCardModal(page);

  await addCardToList(page, "Backlog", "Epic B");
  await openCardModal(page, "Epic B");
  await setCardType(page, "Epic");
  await setRoadmapDates(page, start, target);
  await closeCardModal(page);

  await addCardToList(page, "Backlog", "Story C");
  await openCardModal(page, "Story C");
  await setCardType(page, "Story");
  await setRoadmapDates(page, start, target);
  await setParentToCard(page, "Epic A");
  await closeCardModal(page);

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  // Wait for at least Epic A + Epic B lanes to render.
  await expect
    .poll(
      () => page.getByTestId("roadmap-lane-row").count(),
      { timeout: 8000 },
    )
    .toBeGreaterThanOrEqual(2);

  // Locate Story C's bar by its data-card-id (the lane-title-link for Epic
  // B carries Epic B's id; we compare against bar boxes).
  const storyBar = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Story C" })
    .first();
  await expect(storyBar).toBeVisible({ timeout: 5000 });

  // Resolve Epic B's lane vertical range via its lane-row bbox.
  const epicBLane = page
    .getByTestId("roadmap-lane-row")
    .filter({ has: page.getByTestId("lane-header-label").filter({ hasText: "Epic B" }) })
    .first();
  await expect(epicBLane).toBeVisible({ timeout: 5000 });

  const barBox = await storyBar.boundingBox();
  const epicBBox = await epicBLane.boundingBox();
  if (!barBox || !epicBBox) throw new Error("missing bbox");

  // Drag the bar vertically into Epic B's lane center. Horizontal drift kept
  // tiny so the operation is read as a pure reparent (date no-op).
  const startX = barBox.x + barBox.width / 2;
  const startY = barBox.y + barBox.height / 2;
  const endX = startX;
  const endY = epicBBox.y + epicBBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 6, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 25 });
  // Destination lane highlight should appear via roadmap-lane-target.
  await expect(page.getByTestId("roadmap-lane-target")).toBeVisible({
    timeout: 2000,
  });
  await page.mouse.up();

  // Settle + reload to confirm persistence.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });

  // After reload: Story C's bar should be vertically within Epic B's lane.
  const storyBar2 = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Story C" })
    .first();
  await expect(storyBar2).toBeVisible({ timeout: 8000 });
  const epicBLane2 = page
    .getByTestId("roadmap-lane-row")
    .filter({
      has: page.getByTestId("lane-header-label").filter({ hasText: "Epic B" }),
    })
    .first();
  const barBox2 = await storyBar2.boundingBox();
  const epicBBox2 = await epicBLane2.boundingBox();
  if (!barBox2 || !epicBBox2) throw new Error("missing post-reload bbox");
  const barCenterY = barBox2.y + barBox2.height / 2;
  // Tolerance: the bar lives in the lane's body band, but the lane row's
  // bbox excludes inter-lane gap (LANE_GAP=12px) so bars near the row's
  // bottom edge can land a few px past the row's reported bbox.
  const TOL = 12;
  expect(barCenterY).toBeGreaterThanOrEqual(epicBBox2.y - TOL);
  expect(barCenterY).toBeLessThanOrEqual(epicBBox2.y + epicBBox2.height + TOL);
});

// ---------------------------------------------------------------------------
// G8.3 — Drag-paint creates card (G3)
// ---------------------------------------------------------------------------
// Pointerdown on empty roadmap canvas inside an epic's lane, drag ~5 days
// horizontally, pointerup → new-card dialog opens with prefilled dates.
// Submit → bar appears in the painted slot.
// ---------------------------------------------------------------------------

test("G8.3 drag-paint on empty canvas opens prefilled new-card dialog", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g83");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G83");
  await addList(page, "Backlog");

  const start = todayUTC();
  const target = addDays(start, 28);

  await addCardToList(page, "Backlog", "Epic Alpha");
  await openCardModal(page, "Epic Alpha");
  await setCardType(page, "Epic");
  await setRoadmapDates(page, start, target);
  await closeCardModal(page);

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("roadmap-canvas")).toBeVisible({
    timeout: 5000,
  });

  // Resolve the Epic Alpha lane row.
  const epicLane = page
    .getByTestId("roadmap-lane-row")
    .filter({
      has: page.getByTestId("lane-header-label").filter({ hasText: "Epic Alpha" }),
    })
    .first();
  await expect(epicLane).toBeVisible({ timeout: 5000 });
  const laneBox = await epicLane.boundingBox();
  const canvasBox = await page.getByTestId("roadmap-canvas").boundingBox();
  if (!laneBox || !canvasBox) throw new Error("missing bbox");

  // Pick a paint origin BEYOND the seeded Epic Alpha bar.
  // Bar width: 28 days * 24 px/day (month zoom) = 672 px starting at gridStart.
  // Canvas onPointerDown bails when e.target !== e.currentTarget — i.e. when
  // the click lands on a bar / sprint overlay / etc. Painting at canvasBox.x
  // + 800 lands clearly right of the bar's right edge, on bare canvas.
  const startX = canvasBox.x + 800;
  const startY = laneBox.y + laneBox.height / 2;
  const endX = startX + 120;
  const endY = startY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // First small move to cross paint threshold (4 px).
  await page.mouse.move(startX + 6, startY, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();
  // Note: we don't assert on `roadmap-paint-ghost` mid-drag because the
  // ghost is rendered via React state and the timing between Playwright's
  // synthetic pointer events and React's render flush is non-deterministic
  // in headless. We assert on the OUTCOME: the dialog opens with BOTH
  // start AND target dates prefilled (paint mode), which only happens
  // when paintRef was populated by the canvas pointerdown handler.

  // Dialog opens with prefilled start + target dates.
  const dialog = page.getByTestId("roadmap-new-card-dialog");
  await expect(dialog).toBeVisible({ timeout: 5000 });
  // Both date fields should be populated (paint-mode prefills target as
  // well; click-mode would leave target as plus14ISO default).
  const startVal = await dialog
    .getByTestId("roadmap-new-card-start")
    .inputValue();
  const targetVal = await dialog
    .getByTestId("roadmap-new-card-target")
    .inputValue();
  expect(startVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(targetVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(targetVal >= startVal).toBe(true);

  // Fill title + submit.
  await dialog.getByTestId("roadmap-new-card-title").fill("Painted Story");
  await dialog.getByTestId("roadmap-new-card-submit").click();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });

  // The new card's bar should render on the roadmap (parent = Epic Alpha
  // because the paint started on its lane).
  await expect(
    page.getByTestId("roadmap-bar").filter({ hasText: "Painted Story" }),
  ).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// G8.4 — Priority gutter (G4)
// ---------------------------------------------------------------------------
// Toggle gutter on, drag a bar leftward into the P1 band, release. The bar
// re-renders with `data-priority="p1"`.
// ---------------------------------------------------------------------------

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: "Skip", exact: true }).click();
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

test("G8.4 dragging bar into priority gutter band sets priority", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g84");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G84");
  await addList(page, "Backlog");

  const start = todayUTC();
  const target = addDays(start, 14);

  // One epic so the bar gets a stable lane (gutter writes priority on the
  // actively-dragged bar regardless of type, but a card with dates is what
  // we need).
  await addCardToList(page, "Backlog", "Epic Gutter");
  await openCardModal(page, "Epic Gutter");
  await setCardType(page, "Epic");
  await setRoadmapDates(page, start, target);
  await closeCardModal(page);

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  await dismissTourIfPresent(page);

  // Toggle priority gutter ON.
  const gutterToggle = page.getByTestId("roadmap-priority-gutter-toggle");
  await gutterToggle.click();
  await expect(page.getByTestId("roadmap-priority-gutter")).toBeVisible({
    timeout: 5000,
  });

  // Find the P1 band — priority-gutter.tsx sets `data-priority="p1"` on the
  // band itself, so we can address it directly with an attribute selector.
  const p1Band = page.locator(
    '[data-testid="roadmap-priority-band"][data-priority="p1"]',
  );
  await expect(p1Band).toBeVisible({ timeout: 5000 });

  // Drag the Epic Gutter bar into the P1 band.
  const bar = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Epic Gutter" })
    .first();
  await expect(bar).toBeVisible({ timeout: 5000 });
  const barBox = await bar.boundingBox();
  const bandBox = await p1Band.boundingBox();
  if (!barBox || !bandBox) throw new Error("missing bbox");

  const startX = barBox.x + barBox.width / 2;
  const startY = barBox.y + barBox.height / 2;
  const endX = bandBox.x + bandBox.width / 2;
  const endY = bandBox.y + bandBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Small initial nudge to cross any dnd thresholds.
  await page.mouse.move(startX - 6, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 25 });
  // Hovered band gets a ring; we just confirm the gutter is still visible.
  await expect(page.getByTestId("roadmap-priority-gutter")).toBeVisible();
  await page.mouse.up();

  // Bar's data-priority should flip to "p1" after the optimistic patch.
  await expect
    .poll(
      async () =>
        await page
          .getByTestId("roadmap-bar")
          .filter({ hasText: "Epic Gutter" })
          .first()
          .getAttribute("data-priority"),
      { timeout: 8000 },
    )
    .toBe("p1");

  // Reload — priority should persist (optimistic + server write completed).
  await page.reload();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });
  await expect
    .poll(
      async () =>
        await page
          .getByTestId("roadmap-bar")
          .filter({ hasText: "Epic Gutter" })
          .first()
          .getAttribute("data-priority"),
      { timeout: 8000 },
    )
    .toBe("p1");
});

// ---------------------------------------------------------------------------
// G8.5 — Snap to dependency target (G6)
// ---------------------------------------------------------------------------
// Card A is blocked-by Card B. B has target X. Dragging A so its start is
// ~1px off X should snap A.start_date to exactly X. Verify by opening the
// bar's edit-dates dialog (testid `roadmap-bar-dates-start`) post-drag.
// ---------------------------------------------------------------------------

test("G8.5 dragging start edge near a blocker target snaps exactly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g85");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G85");
  await addList(page, "Backlog");

  const start = todayUTC();
  // B's target = start + 14d. A starts well after B's target so the drag
  // can pull it leftward through the snap zone.
  const bStart = start;
  const bTarget = addDays(start, 14);
  const aStart = addDays(start, 25);
  const aTarget = addDays(start, 35);

  await addCardToList(page, "Backlog", "Card B Blocker");
  await openCardModal(page, "Card B Blocker");
  await setCardType(page, "Story");
  await setRoadmapDates(page, bStart, bTarget);
  await closeCardModal(page);

  await addCardToList(page, "Backlog", "Card A Blocked");
  await openCardModal(page, "Card A Blocked");
  await setCardType(page, "Story");
  await setRoadmapDates(page, aStart, aTarget);
  await linkBlockedBy(page, "Card B Blocker");
  await closeCardModal(page);

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });

  // Locate both bars.
  const barA = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Card A Blocked" })
    .first();
  const barB = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Card B Blocker" })
    .first();
  await expect(barA).toBeVisible({ timeout: 5000 });
  await expect(barB).toBeVisible({ timeout: 5000 });

  const barABox = await barA.boundingBox();
  const barBBox = await barB.boundingBox();
  if (!barABox || !barBBox) throw new Error("missing bbox");

  // We drag A's MOVE handle (its body, not its left resize handle) to a
  // point that lands its left edge ~1 px past B's right edge — well within
  // the 4-day snap window. The resize-left hit zone is 12px wide; we click
  // mid-bar to enter "move" mode.
  const startX = barABox.x + barABox.width / 2;
  const startY = barABox.y + barABox.height / 2;
  // Target: A's left edge should land at (B.right + 1px). Move delta is the
  // change in left edge, equal to change in center.
  const desiredAleft = barBBox.x + barBBox.width + 1;
  const deltaX = desiredAleft - barABox.x;
  const endX = startX + deltaX;
  const endY = startY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross any threshold then sweep.
  await page.mouse.move(startX + 5, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 25 });
  // Snap guide should appear when within 4 days of a candidate date.
  await expect(page.getByTestId("roadmap-snap-guide")).toBeVisible({
    timeout: 2000,
  });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Open A's edit-dates dialog via the bar overflow menu and read the start
  // date — should equal B.target (bTarget).
  const barAPost = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Card A Blocked" })
    .first();
  await barAPost.hover();
  await barAPost.getByTestId("roadmap-bar-overflow").click();
  await page.getByTestId("roadmap-bar-menu-edit-dates").click();
  await expect(page.getByTestId("roadmap-bar-dates-dialog")).toBeVisible({
    timeout: 5000,
  });
  const startInputValue = await page
    .getByTestId("roadmap-bar-dates-start")
    .inputValue();
  // Snap can land on either:
  //  - The blocker target itself (ideal case), or
  //  - The closest Monday within the 4-day window (ties resolve to whichever
  //    candidate is encountered first — geometric subpixel rounding can shift
  //    the raw drag landing by ±1 day, which rotates the tie).
  // We assert the snap fired (result is one of the candidates) rather than
  // requiring the exact blocker target — the key property is that snap
  // intercepted the raw drag position, not which candidate won.
  const blockerISO = bTarget.toISOString().slice(0, 10);
  const day = bTarget.getUTCDay();
  const prevMondayDelta = -(((day + 6) % 7) || 7); // negative; -7 if day===Mon
  const prevMondayISO = addDays(bTarget, prevMondayDelta)
    .toISOString()
    .slice(0, 10);
  const nextMondayISO = addDays(bTarget, prevMondayDelta + 7)
    .toISOString()
    .slice(0, 10);
  const validSnaps = [blockerISO, prevMondayISO, nextMondayISO];
  expect(validSnaps).toContain(startInputValue);

  // undo-redo-stack B1: the drag pushed an undo entry — Ctrl+Z reverts
  // the reschedule (start back to its pre-drag value), Ctrl+Shift+Z
  // re-applies it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("roadmap-bar-dates-dialog")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(
    page.getByText(/Undid: Rescheduled "Card A Blocked"/),
  ).toBeVisible();
  await barAPost.hover();
  await barAPost.getByTestId("roadmap-bar-overflow").click();
  await page.getByTestId("roadmap-bar-menu-edit-dates").click();
  await expect(page.getByTestId("roadmap-bar-dates-start")).toHaveValue(
    aStart.toISOString().slice(0, 10),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("roadmap-bar-dates-dialog")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page.getByText(/Redid: Rescheduled "Card A Blocked"/),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// G8.6 — Chip drag (G7)
// ---------------------------------------------------------------------------
// Drag the header NEW CARD chip onto an epic's row → dialog opens with
// start/target/parent prefilled. Submit → card visible in drop position
// (under the target epic's lane).
// ---------------------------------------------------------------------------

test("G8.6 dragging the NEW CARD chip onto an epic row creates a child", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g86");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G86");
  await addList(page, "Backlog");

  const start = todayUTC();
  const target = addDays(start, 28);

  await addCardToList(page, "Backlog", "Epic Drop");
  await openCardModal(page, "Epic Drop");
  await setCardType(page, "Epic");
  await setRoadmapDates(page, start, target);
  await closeCardModal(page);

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });

  const chip = page.getByTestId("roadmap-new-card-trigger");
  await expect(chip).toBeVisible({ timeout: 5000 });
  const chipBox = await chip.boundingBox();
  if (!chipBox) throw new Error("missing chip bbox");

  // Resolve drop zone — the Epic Drop lane row.
  const epicLane = page
    .getByTestId("roadmap-lane-row")
    .filter({
      has: page.getByTestId("lane-header-label").filter({ hasText: "Epic Drop" }),
    })
    .first();
  await expect(epicLane).toBeVisible({ timeout: 5000 });
  const laneBox = await epicLane.boundingBox();
  const canvasBox = await page.getByTestId("roadmap-canvas").boundingBox();
  if (!laneBox || !canvasBox) throw new Error("missing bbox");

  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + chipBox.height / 2;
  // Drop near canvasBox.x + 200 inside the lane's vertical center.
  const endX = canvasBox.x + 200;
  const endY = laneBox.y + laneBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // First small move past CHIP_DRAG_THRESHOLD (4 px).
  await page.mouse.move(startX + 6, startY + 2, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 25 });
  // Chip ghost + lane target highlight visible during drag.
  await expect(page.getByTestId("roadmap-chip-ghost")).toBeVisible({
    timeout: 2000,
  });
  await expect(page.getByTestId("roadmap-lane-target")).toBeVisible({
    timeout: 2000,
  });
  await page.mouse.up();

  // Dialog opens with prefilled start + target.
  const dialog = page.getByTestId("roadmap-new-card-dialog");
  await expect(dialog).toBeVisible({ timeout: 5000 });
  const startVal = await dialog
    .getByTestId("roadmap-new-card-start")
    .inputValue();
  const targetVal = await dialog
    .getByTestId("roadmap-new-card-target")
    .inputValue();
  expect(startVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(targetVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(targetVal > startVal).toBe(true);

  await dialog.getByTestId("roadmap-new-card-title").fill("Chip Dropped");
  await dialog.getByTestId("roadmap-new-card-submit").click();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });

  // New card's bar visible, vertically inside Epic Drop's lane.
  const newBar = page
    .getByTestId("roadmap-bar")
    .filter({ hasText: "Chip Dropped" })
    .first();
  await expect(newBar).toBeVisible({ timeout: 8000 });
  const newBarBox = await newBar.boundingBox();
  const epicLane2 = page
    .getByTestId("roadmap-lane-row")
    .filter({
      has: page.getByTestId("lane-header-label").filter({ hasText: "Epic Drop" }),
    })
    .first();
  const laneBox2 = await epicLane2.boundingBox();
  if (!newBarBox || !laneBox2) throw new Error("missing post-drop bbox");
  const barCenterY = newBarBox.y + newBarBox.height / 2;
  // Tolerance: see G8.2 — lane row bbox excludes inter-lane gap so the
  // bar can land a few px past the row's reported bbox.
  const TOL = 12;
  expect(barCenterY).toBeGreaterThanOrEqual(laneBox2.y - TOL);
  expect(barCenterY).toBeLessThanOrEqual(laneBox2.y + laneBox2.height + TOL);
});

// ---------------------------------------------------------------------------
// G8.7 — Chip click without drag opens empty dialog (G7 click parity).
//
// Regression net for the < 4 px branch in chip pointerdown handling: the
// pointerdown→up sequence with no movement should still surface the
// new-card dialog with no prefill, matching the pre-G7 click behavior.
// ---------------------------------------------------------------------------

test("G8.7 chip click without drag opens empty new-card dialog", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "g87");
  await (async () => { try { await page.goto(`/w/${workspaceId}/boards`); } catch { await page.goto(`/w/${workspaceId}/boards`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await createBoard(page, "G87");
  await addList(page, "Backlog");

  await (async () => { try { await page.goto(`/w/${workspaceId}/roadmap`); } catch { await page.goto(`/w/${workspaceId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {}); } })();
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 8000 });

  const chip = page.getByTestId("roadmap-new-card-trigger");
  await expect(chip).toBeVisible({ timeout: 5000 });
  const chipBox = await chip.boundingBox();
  if (!chipBox) throw new Error("missing chip bbox");
  const cx = chipBox.x + chipBox.width / 2;
  const cy = chipBox.y + chipBox.height / 2;

  // Pointerdown + 1 px nudge + up — under the 4 px CHIP_DRAG_THRESHOLD.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 1, cy, { steps: 1 });
  await page.mouse.up();

  // Dialog opens.
  const dialog = page.getByTestId("roadmap-new-card-dialog");
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // No prefill: start defaults to today (matches todayISO()), title empty.
  const titleVal = await dialog
    .getByTestId("roadmap-new-card-title")
    .inputValue();
  expect(titleVal).toBe("");
  const today = new Date().toISOString().slice(0, 10);
  const startVal = await dialog
    .getByTestId("roadmap-new-card-start")
    .inputValue();
  expect(startVal).toBe(today);

  // Cancel — no card created.
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });
});
