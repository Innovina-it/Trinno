import { test, expect, type Page, type Locator } from "@playwright/test";

// E2E coverage for Gantt baselines: save + list, compare → variance (ghost /
// delta chip / variance panel), member read-only gating, and rename + delete.
//
// Conventions reused from the existing harness:
//  - Auth/seed: `tr_seed_demo` cookie + `/signup` with an @innovina.it email,
//    landing on `/w/<id>` (mirrors roadmap-completion.spec.ts /
//    realtime.spec.ts). Local signup's domain allowlist rejects example.com,
//    so BOTH the owner and the second member sign up in-app with @innovina.it
//    (links.spec.ts uses the same member pattern). We seed the DEMO workspace
//    (`tr_seed_demo=1`) because it creates dated cards, so the Gantt renders
//    `roadmap-bar`s with start+target dates out of the box — same reliance as
//    roadmap-completion.spec.ts.
//  - Two-user member flow (owner invites by email; member signs up separately
//    and opens the workspace roadmap): mirrors realtime.spec.ts / links.spec.ts.
//  - gotoWithRetry: Next.js dev-mode RSC streaming can ERR_ABORTED the first
//    cold-compile navigation; retry once (mirrors invitations.spec.ts).
//
// Selectors are EXACT per the committed baseline data-testid hooks:
//   menu trigger      baseline-menu
//   save              baseline-save-open → baseline-save-dialog /
//                     baseline-name-input / baseline-note-input /
//                     baseline-save-submit
//   rows              baseline-row-<id> (Compare on click);
//                     baseline-rename-<id> / baseline-delete-<id>
//   rename dialog     baseline-rename-dialog / baseline-rename-name /
//                     baseline-rename-submit
//   compare banner    baseline-compare-banner / baseline-variance-toggle /
//                     baseline-stop-comparing
//   per-card overlay  baseline-ghost-<cardId> / baseline-delta-<cardId>
//   variance panel    baseline-variance-panel / variance-row-<cardId> /
//                     baseline-variance-close
//
// Date-shift: cards expose an "Edit dates" affordance via the bar's context
// menu (right-click → roadmap-bar-menu → roadmap-bar-menu-edit-dates), opening
// roadmap-bar-dates-dialog. The TARGET DatePicker has a typeable text input
// (date-picker-display, dd/mm/yyyy) inside roadmap-bar-dates-target; typing a
// far-future date commits it, then roadmap-bar-dates-save persists via
// updateCard. We save the baseline FIRST (capturing the original target), then
// push the target LATER, so Compare reports the card as Slipped.

const PW = "passw0rd!";

function uniqEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
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

// Signs up an owner on the DEMO seed (dated cards → Gantt bars) and returns the
// landing workspace id.
async function signupSeededOwner(page: Page, email: string): Promise<string> {
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "1", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
}

// A minimal-seed signup for the second user (no workspace of their own needed;
// they'll be invited into the owner's workspace).
async function signupMember(page: Page, email: string) {
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
}

async function dismissTourIfPresent(page: Page) {
  const tour = page.getByTestId("tour-overlay");
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: /skip/i }).click().catch(() => {});
    await tour.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function gotoRoadmap(page: Page, wsId: string) {
  await gotoWithRetry(page, `/w/${wsId}/roadmap`);
  await dismissTourIfPresent(page);
  await expect(page.getByTestId("roadmap-grid")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => page.locator('[data-testid="roadmap-bar"]').count(), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(1);
}

// First Gantt bar that carries a data-card-id.
async function firstBarCardId(page: Page): Promise<string> {
  const bar = page.locator('[data-testid="roadmap-bar"][data-card-id]').first();
  await expect(bar).toBeVisible({ timeout: 10_000 });
  const id = await bar.getAttribute("data-card-id");
  if (!id) throw new Error("roadmap bar without data-card-id");
  return id;
}

// Two-digit dd/mm/yyyy for the DatePicker text input.
function dmy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Pushes a card's TARGET date far into the future via the bar's Edit-dates
// dialog, so a saved baseline registers it as Slipped.
async function shiftTargetLater(page: Page, cardId: string) {
  const bar = page
    .locator(`[data-testid="roadmap-bar"][data-card-id="${cardId}"]`)
    .first();
  await bar.click({ button: "right" });
  const menu = page.getByTestId("roadmap-bar-menu");
  await expect(menu).toBeVisible();
  await page.getByTestId("roadmap-bar-menu-edit-dates").click();
  await expect(page.getByTestId("roadmap-bar-dates-dialog")).toBeVisible();

  // 200 days out is comfortably later than any demo-seed target and after the
  // card's start (the dialog's target picker only enforces target >= start).
  const later = new Date(Date.now() + 200 * 86_400_000);
  const targetInput = page
    .getByTestId("roadmap-bar-dates-target")
    .getByTestId("date-picker-display");
  await targetInput.click();
  await targetInput.fill(dmy(later));
  // Typing into the field pops the "Pick date" calendar popover, which animates
  // and re-anchors — leaving the Save button "unstable / detached". The popover
  // closes on a click OUTSIDE it; clicking the dialog title (inside the dates
  // dialog, outside the popover) dismisses the calendar WITHOUT closing the
  // whole dialog (Escape would close the dialog too). Wait for the popover to
  // detach so the dialog DOM is settled before clicking Save.
  const calendar = page.getByRole("dialog", { name: "Pick date" });
  await page.getByRole("heading", { name: "Edit dates" }).click();
  await expect(calendar).toHaveCount(0, { timeout: 5000 });
  const save = page.getByTestId("roadmap-bar-dates-save");
  await save.click();
  await expect(page.getByTestId("roadmap-bar-dates-dialog")).toHaveCount(0);
}

async function openBaselineMenu(page: Page) {
  await page.getByTestId("baseline-menu").click();
  // The dropdown content carries the Save item (owner) or the rows.
  await expect(page.getByTestId("baseline-save-open").or(page.getByTestId("baseline-empty")).or(page.locator('[data-testid^="baseline-row-"]')).first()).toBeVisible({ timeout: 10_000 });
}

// Saves a baseline through the menu and returns the new baseline's id (parsed
// from the freshly-appeared baseline-row-<id>).
async function saveBaseline(page: Page, name: string): Promise<string> {
  await openBaselineMenu(page);
  await page.getByTestId("baseline-save-open").click();
  await expect(page.getByTestId("baseline-save-dialog")).toBeVisible();
  await page.getByTestId("baseline-name-input").fill(name);
  await page.getByTestId("baseline-note-input").fill(`note for ${name}`);
  await page.getByTestId("baseline-save-submit").click();
  await expect(page.getByTestId("baseline-save-dialog")).toHaveCount(0);

  // Re-open the menu; the new row is keyed baseline-row-<id>.
  await openBaselineMenu(page);
  const row = page.locator('[data-testid^="baseline-row-"]').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const tid = await row.getAttribute("data-testid");
  return tid!.replace("baseline-row-", "");
}

test.describe("gantt baselines", () => {
  test("save + list: owner saves a baseline and it appears in the menu", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ws = await signupSeededOwner(page, uniqEmail("bl-save"));
    await gotoRoadmap(page, ws);

    await openBaselineMenu(page);
    await page.getByTestId("baseline-save-open").click();
    await expect(page.getByTestId("baseline-save-dialog")).toBeVisible();
    await page.getByTestId("baseline-name-input").fill("Plan v1");
    await page.getByTestId("baseline-save-submit").click();
    await expect(page.getByTestId("baseline-save-dialog")).toHaveCount(0);

    await openBaselineMenu(page);
    const row = page.locator('[data-testid^="baseline-row-"]').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Plan v1");
  });

  test("compare shows variance: a slipped card surfaces a delta chip + variance panel", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ws = await signupSeededOwner(page, uniqEmail("bl-cmp"));
    await gotoRoadmap(page, ws);

    const cardId = await firstBarCardId(page);

    // Baseline captures the ORIGINAL target first.
    const baselineId = await saveBaseline(page, "Plan v1");
    // Close the menu so the date dialog is interactable.
    await page.keyboard.press("Escape");

    // Push this card's target LATER → it should read as Slipped.
    await shiftTargetLater(page, cardId);

    // Compare against the baseline via its row.
    await openBaselineMenu(page);
    await page.getByTestId(`baseline-row-${baselineId}`).click();

    // The compare banner only renders when variance exists.
    await expect(page.getByTestId("baseline-compare-banner")).toBeVisible({
      timeout: 10_000,
    });

    // The shifted card shows a +Nd delta chip and/or a ghost bar.
    const delta = page.getByTestId(`baseline-delta-${cardId}`);
    const ghost = page.getByTestId(`baseline-ghost-${cardId}`);
    await expect(delta.or(ghost).first()).toBeVisible({ timeout: 10_000 });
    if (await delta.count()) {
      await expect(delta).toContainText(/\+\d+d/);
    }

    // Open the variance panel; the card is listed under Slipped.
    await page.getByTestId("baseline-variance-toggle").click();
    await expect(page.getByTestId("baseline-variance-panel")).toBeVisible();
    await expect(page.getByTestId(`variance-row-${cardId}`)).toBeVisible({
      timeout: 10_000,
    });

    // Stop comparing → the banner disappears.
    await page.getByTestId("baseline-stop-comparing").click();
    await expect(page.getByTestId("baseline-compare-banner")).toHaveCount(0);
  });

  test("member read-only: a normal member can Compare but cannot Save / rename / delete", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const ctxOwner = await browser.newContext();
    const ctxMember = await browser.newContext();
    const owner = await ctxOwner.newPage();
    const member = await ctxMember.newPage();

    const ownerEmail = uniqEmail("bl-mem-own");
    const memberEmail = uniqEmail("bl-mem");
    const memberLocal = memberEmail.split("@")[0];

    const ws = await signupSeededOwner(owner, ownerEmail);
    await gotoRoadmap(owner, ws);

    // Owner saves a baseline the member should be able to Compare against.
    await saveBaseline(owner, "Shared baseline");

    // Member signs up, then owner invites them into the workspace (member role).
    await signupMember(member, memberEmail);
    await gotoWithRetry(owner, `/w/${ws}/settings`);
    await owner.getByLabel("Email").fill(memberEmail);
    await owner.getByRole("button", { name: /^invite$/i }).click();
    await expect(owner.getByText(memberLocal)).toBeVisible({ timeout: 15_000 });

    // Member opens the workspace roadmap. Their default "Mine" filter may leave
    // the Gantt empty (no cards assigned to them), so don't wait for bars — the
    // Baselines menu lives in the header and renders regardless.
    await gotoWithRetry(member, `/w/${ws}/roadmap`);
    await dismissTourIfPresent(member);
    await member.getByTestId("baseline-menu").click();

    // Compare is available: the existing baseline row is present...
    const memberRow = member.locator('[data-testid^="baseline-row-"]').first();
    await expect(memberRow).toBeVisible({ timeout: 10_000 });
    await expect(memberRow).toContainText("Shared baseline");

    // ...but management controls are hidden: no Save item, no rename/delete.
    await expect(member.getByTestId("baseline-save-open")).toHaveCount(0);
    await expect(
      member.locator('[data-testid^="baseline-rename-"]'),
    ).toHaveCount(0);
    await expect(
      member.locator('[data-testid^="baseline-delete-"]'),
    ).toHaveCount(0);

    await ctxOwner.close();
    await ctxMember.close();
  });

  test("rename + delete (owner): rename updates the row, delete removes it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ws = await signupSeededOwner(page, uniqEmail("bl-rd"));
    await gotoRoadmap(page, ws);

    const baselineId = await saveBaseline(page, "Original name");

    // Rename.
    await page.getByTestId(`baseline-rename-${baselineId}`).click();
    await expect(page.getByTestId("baseline-rename-dialog")).toBeVisible();
    await page.getByTestId("baseline-rename-name").fill("Renamed plan");
    await page.getByTestId("baseline-rename-submit").click();
    await expect(page.getByTestId("baseline-rename-dialog")).toHaveCount(0);

    await openBaselineMenu(page);
    await expect(page.getByTestId(`baseline-row-${baselineId}`)).toContainText(
      "Renamed plan",
    );

    // Delete (confirm via window.confirm).
    page.on("dialog", (d) => d.accept());
    await page.getByTestId(`baseline-delete-${baselineId}`).click();
    await expect(page.getByTestId(`baseline-row-${baselineId}`)).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
