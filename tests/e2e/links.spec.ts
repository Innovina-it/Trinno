import { test, expect, type Page } from "@playwright/test";

// E2E coverage for the URL-link entity (card links + workspace link).
//
// Conventions reused from the existing harness:
//  - Auth/seed: `tr_seed_demo` cookie + `/signup` with an @innovina.it email,
//    landing on `/w/<id>/roadmap` (see card-quick-view-back.spec.ts /
//    realtime.spec.ts). Local signup rejects example.com for the owner path,
//    so owners use @innovina.it; the realtime spec uses example.com for the
//    second member because that user is created via in-app signup too.
//  - Two-user member flow (owner invites by email, member signs up separately
//    and navigates to the workspace-visible board): mirrors realtime.spec.ts.
//  - Board + list + card creation: mirrors card-features.spec.ts (the inline
//    card composer is now a dialog — NewCardDialog). Card-link scenarios run
//    on a freshly-created board for determinism rather than the demo seed, and
//    exercise the link icon from the card quick view (clicking a tile opens
//    `card-quick-view`, which renders the shared `link-icon-card`).
//
// Selectors are EXACT per the link feature's committed data-testid hooks.

const PW = "passw0rd!";

function uniqEmail(prefix: string, domain = "innovina.it"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${domain}`;
}

// Next.js dev-mode streams RSC; a cold-compile of a route can ERR_ABORTED the
// first navigation. Retry once, mirroring invitations.spec.ts.
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
  // Seed cookie keeps signup deterministic; uncheck the demo-seed box so the
  // landing workspace is minimal (we create our own board below).
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
): Promise<string> {
  // Navigate by URL rather than clicking the nav <Link>; the post-signup
  // roadmap shell may not have hydrated its client router yet, so an early
  // nav click is a no-op on a cold dev server.
  await gotoWithRetry(page, `/w/${wsId}/boards`);
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/boards/);

  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Title").fill(boardTitle);
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: boardTitle })).toBeVisible();
  const boardUrl = page.url();

  await page.getByRole("button", { name: "+ Add a list" }).click();
  await page.getByPlaceholder("List title").fill("Tasks");
  await page.getByRole("button", { name: /^add list$/i }).click();
  const col = page.locator("[data-list-id]").filter({ hasText: "Tasks" }).first();
  await expect(col).toBeVisible();

  // Add a card via the NewCardDialog (the inline composer was replaced by a
  // dialog defaulting board+list to this column).
  await col.getByTestId("list-add-card").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("roadmap-new-card-title").fill(cardTitle);
  await page.getByTestId("roadmap-new-card-submit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The board defaults its assignee filter to "Mine"; a dialog-created card
  // is unassigned, so flip to "All" via URL so the filter state is
  // deterministic. Clicking the chip in dev mode races with React 19's
  // shallow window.history.replaceState dispatch and is flaky.
  const url = new URL(page.url());
  url.searchParams.set("assignee", "all");
  await page.goto(url.toString());
  await expect(
    page.locator("[data-card-id]").filter({ hasText: cardTitle }),
  ).toBeVisible();

  return boardUrl;
}

// Clicking a board card tile opens the card QUICK VIEW (card-quick-view),
// which renders `link-icon-card` (the shared LinkIcon) in its title row. The
// full card-modal's `card-link-section` wrapper is only reachable from the
// modal route, but the link icon + its data-haslink / click / long-press
// behavior is the identical shared component, so card-link scenarios exercise
// it here from the quick view.
async function openCardQuickView(page: Page, cardTitle: string) {
  const tile = page.locator("[data-card-id]").filter({ hasText: cardTitle }).first();
  await tile.click();
  await expect(page.getByTestId("card-quick-view")).toBeVisible();
  await expect(page.getByTestId("link-icon-card")).toBeVisible();
}

test.describe("card link", () => {
  test("owner creates a card link → chain becomes diamond → opens normalized URL", async ({
    page,
    context,
  }) => {
    const wsId = await signupOwner(page, uniqEmail("link-own"));
    await createBoardWithCard(page, wsId, "Links Board", "Linkable card");
    await openCardQuickView(page, "Linkable card");

    const icon = page.getByTestId("link-icon-card");
    // No link yet, owner can edit → chain affordance.
    await expect(icon).toHaveAttribute("data-haslink", "0");

    await icon.click();
    await expect(page.getByTestId("link-edit-dialog")).toBeVisible();
    await page.getByTestId("link-url-input").fill("drive.google.com/folder/abc");
    await page.getByTestId("link-color-blu").click();
    // With a fresh URL the action button reads "Save" (dialog is dirty).
    await expect(page.getByTestId("link-save")).toHaveText("Save");
    await page.getByTestId("link-save").click();

    // Icon flips to diamond (has-link). Optimistic store update is synchronous.
    await expect(icon).toHaveAttribute("data-haslink", "1");

    // The optimistic store first holds the raw input; the server action
    // normalizes (prepends https://) and the confirmed value replaces it. Wait
    // for that commit so the diamond opens the NORMALIZED URL, not the raw one.
    await page.waitForTimeout(1200);

    // Clicking the diamond opens the normalized URL in a new tab.
    const popupPromise = context.waitForEvent("page");
    await icon.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    expect(popup.url()).toContain("https://drive.google.com/folder/abc");
    await popup.close();
  });

  test("Close↔Save label toggles with dirtiness", async ({ page }) => {
    const wsId = await signupOwner(page, uniqEmail("link-lbl"));
    await createBoardWithCard(page, wsId, "Label Board", "Label card");
    await openCardQuickView(page, "Label card");

    // Seed a link first so we re-open onto an existing link.
    const icon = page.getByTestId("link-icon-card");
    await icon.click();
    await expect(page.getByTestId("link-edit-dialog")).toBeVisible();
    await page.getByTestId("link-url-input").fill("https://example.com/doc");
    await expect(page.getByTestId("link-save")).toHaveText("Save");
    await page.getByTestId("link-save").click();
    await expect(icon).toHaveAttribute("data-haslink", "1");

    // Re-open via long-press (owner can edit an existing link by holding).
    const box = await icon.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByTestId("link-edit-dialog")).toBeVisible();

    // No change yet → "Close".
    await expect(page.getByTestId("link-save")).toHaveText("Close");
    // Editing the URL flips it to "Save".
    await page.getByTestId("link-url-input").fill("https://example.com/doc-v2");
    await expect(page.getByTestId("link-save")).toHaveText("Save");
  });

  test("member can open but not edit a card link (long-press is inert)", async ({
    browser,
  }) => {
    const ctxOwner = await browser.newContext();
    const ctxMember = await browser.newContext();
    const owner = await ctxOwner.newPage();
    const member = await ctxMember.newPage();

    const ownerEmail = uniqEmail("link-mem-own");
    // Member signs up in-app too; local signup's domain allowlist rejects
    // example.com, so use @innovina.it. The invite below grants member role.
    const memberEmail = uniqEmail("link-mem");
    const memberLocal = memberEmail.split("@")[0];

    const wsId = await signupOwner(owner, ownerEmail);
    const boardUrl = await createBoardWithCard(owner, wsId, "Member Board", "Shared card");

    // Owner attaches a link to the card.
    await openCardQuickView(owner, "Shared card");
    const ownerIcon = owner.getByTestId("link-icon-card");
    await ownerIcon.click();
    await expect(owner.getByTestId("link-edit-dialog")).toBeVisible();
    await owner.getByTestId("link-url-input").fill("https://drive.google.com/x");
    await owner.getByTestId("link-save").click();
    await expect(ownerIcon).toHaveAttribute("data-haslink", "1");

    // Member signs up, then owner invites them into the workspace.
    await signupOwner(member, memberEmail);
    await gotoWithRetry(owner, `/w/${wsId}/settings`);
    await owner.getByLabel("Email").fill(memberEmail);
    await owner.getByRole("button", { name: /^invite$/i }).click();
    // The member row shows both displayName + `· @handle`; either suffices,
    // so use first() to avoid strict-mode collision on the duplicated text.
    await expect(
      owner.getByText(memberLocal).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Member opens the workspace-visible board + card.
    await member.goto(boardUrl);
    await expect(member.getByRole("heading", { name: "Member Board" })).toBeVisible();
    // The unassigned card is hidden by the default "Mine" filter for B too.
    // Use URL to avoid the shallow-replaceState race seen in dev mode.
    {
      const url = new URL(member.url());
      url.searchParams.set("assignee", "all");
      await member.goto(url.toString());
    }
    await openCardQuickView(member, "Shared card");

    const memberIcon = member.getByTestId("link-icon-card");
    await expect(memberIcon).toHaveAttribute("data-haslink", "1");

    // Long-press must NOT open the edit dialog for a non-editor.
    const box = await memberIcon.boundingBox();
    expect(box).toBeTruthy();
    await member.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await member.mouse.down();
    await member.waitForTimeout(700);
    await member.mouse.up();
    await expect(member.getByTestId("link-edit-dialog")).toHaveCount(0);

    // Best-effort close; Playwright sometimes hits an ENOENT flushing
    // its own trace artifacts at the end of a multi-context run.
    await ctxOwner.close().catch(() => {});
    await ctxMember.close().catch(() => {});
  });
});

test.describe("workspace link", () => {
  test("owner sets workspace link via settings → cloud icon appears once (not in dropdown)", async ({
    page,
  }) => {
    const wsId = await signupOwner(page, uniqEmail("ws-link-own"));

    // The workspace cloud icon only renders once a link exists, so set it first
    // through settings.
    await gotoWithRetry(page, `/w/${wsId}/settings`);
    await page.getByTestId("ws-link-manage").click();
    await expect(page.getByTestId("link-edit-dialog")).toBeVisible();
    await page.getByTestId("link-url-input").fill("drive.google.com/team");
    await expect(page.getByTestId("link-save")).toHaveText("Save");
    await page.getByTestId("link-save").click();
    // Dialog closes after save.
    await expect(page.getByTestId("link-edit-dialog")).toHaveCount(0);

    // The cloud icon now sits next to the active workspace name in the switcher
    // (a sibling OUTSIDE the dropdown menu). router.refresh() re-renders the
    // server component; reload to be deterministic on a cold dev server.
    await page.reload();
    const wsIcon = page.getByTestId("link-icon-workspace");
    await expect(wsIcon).toHaveCount(1);
    await expect(wsIcon).toHaveAttribute("data-haslink", "1");

    // Opening the switcher dropdown must NOT introduce another link icon: the
    // menu items list workspaces only, no per-row link affordance.
    await page.getByTestId("workspace-switcher-trigger").click();
    await expect(page.getByTestId("workspace-switcher-new")).toBeVisible();
    // Still exactly one workspace link icon on the page (the sibling outside).
    await expect(page.getByTestId("link-icon-workspace")).toHaveCount(1);
  });
});
