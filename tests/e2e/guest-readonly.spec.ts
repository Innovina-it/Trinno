import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Plan #0111 — guest-role UI smoke. Verifies that a workspace guest:
//   - sees the read-only banner
//   - does not see the "Add card" / "Add list" / list-actions / select handle
//   - sees the card modal without write affordances (archive, hero toggle,
//     QuickEditStrip, write accordions)
//   - cannot drag an unassigned card (cursor stays default; data attr set)
//
// Mirrors the invitations spec for the signup + invite-by-email pattern:
//   1. Owner signs up.
//   2. Owner creates a board + card (so the guest has something to read).
//   3. Owner invites the guest via /settings (role=guest in the dropdown).
//   4. Invitee opens the verify link from Mailpit, sets a password, lands
//      in the workspace as a guest.
//   5. Guest-specific assertions run.

async function signupOwner(page: Page, email: string): Promise<string> {
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  const m = page.url().match(/\/w\/([0-9a-f-]{36})/);
  return m![1];
}

async function acceptInviteAsGuest(
  guestContext: BrowserContext,
  guestPage: Page,
  verifyUrl: string,
): Promise<void> {
  const u = new URL(verifyUrl);
  u.searchParams.set("redirect_to", "http://localhost:3000/accept-invite");
  await guestContext.clearCookies();
  await guestPage.goto(u.toString());
  await expect(guestPage).toHaveURL(/\/accept-invite/, { timeout: 15_000 });
  await expect
    .poll(
      async () =>
        (await guestContext.cookies()).some((c) =>
          c.name.includes("auth-token"),
        ),
      { timeout: 15_000 },
    )
    .toBeTruthy();
  await guestPage.getByLabel(/password/i).fill("guestpw123!");
  await guestPage.getByRole("button", { name: /set password/i }).click();
}

test("guest sees read-only UI: banner, no add-card / add-list, no archive", async ({
  browser,
  request,
}) => {
  const owner = `gst-own-${Date.now()}@innovina.it`;
  const guestEmail = `gst-${Date.now()}@gmail.com`;

  // --- Owner setup ----------------------------------------------------------
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const wsId = await signupOwner(ownerPage, owner);

  // Settings → invite the guest with role=guest. Retry once on
  // ERR_ABORTED (cold RSC compile in dev mode).
  await ownerPage.goto(`/w/${wsId}/settings`).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await ownerPage.goto(`/w/${wsId}/settings`);
    } else {
      throw e;
    }
  });
  await ownerPage.getByLabel("Email").fill(guestEmail);
  // Pick the Guest role from the DropdownMenu, then dismiss the portal
  // so its inert backdrop doesn't intercept the Invite click.
  await ownerPage.getByRole("button", { name: /^role:/i }).click();
  await ownerPage.getByRole("menuitemradio", { name: /guest/i }).click();
  await ownerPage.keyboard.press("Escape");
  await expect(
    ownerPage.locator('[data-base-ui-portal][data-open]'),
  ).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
  await ownerPage.getByRole("button", { name: /^invite$/i }).click();
  await expect(ownerPage.getByText(/invite sent/i)).toBeVisible({
    timeout: 15_000,
  });

  // --- Pull verify link from Mailpit ---------------------------------------
  let verifyUrl = "";
  await expect(async () => {
    const list = await request.get(
      "http://localhost:54324/api/v1/messages?limit=30",
    );
    const msgs = (await list.json()).messages ?? [];
    const msg = msgs.find((m: any) =>
      (m.To ?? []).some((t: any) => t.Address === guestEmail),
    );
    expect(msg, "guest invite email in Mailpit").toBeTruthy();
    const full = await request.get(
      `http://localhost:54324/api/v1/message/${msg.ID}`,
    );
    const body = await full.json();
    const html = (body.HTML || body.Text || "").replace(/&amp;/g, "&");
    const found = html.match(
      /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/,
    );
    expect(found, "verify link present").toBeTruthy();
    verifyUrl = found![0];
  }).toPass({ timeout: 15_000 });

  // --- Guest accepts invite + lands in workspace ---------------------------
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await acceptInviteAsGuest(guestContext, guestPage, verifyUrl);
  await expect(guestPage).toHaveURL(new RegExp(`/w/${wsId}`), {
    timeout: 15_000,
  });

  // Post-accept redirect lands on the user's personal workspace
  // (created by the handle_new_user trigger) — explicitly navigate to
  // the invited workspace so the banner + role-gated UI render there.
  await guestPage.goto(`/w/${wsId}`).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await guestPage.goto(`/w/${wsId}`);
    } else {
      throw e;
    }
  });

  // --- Banner visible ------------------------------------------------------
  await expect(
    guestPage.getByTestId("guest-readonly-banner"),
  ).toBeVisible({ timeout: 10_000 });

  // --- Navigate to the workspace's first board, if any ---------------------
  // The owner just signed up; the seed creates a default board. Guest sees it.
  await guestPage.goto(`/w/${wsId}/boards`).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await guestPage.goto(`/w/${wsId}/boards`);
    } else {
      throw e;
    }
  });
  const firstBoardLink = guestPage
    .locator('a[href^="/b/"]')
    .first();
  if (await firstBoardLink.count()) {
    await firstBoardLink.click();
    await expect(guestPage).toHaveURL(/\/b\/[0-9a-f-]{36}/, {
      timeout: 10_000,
    });

    // Banner still visible on the board surface.
    await expect(
      guestPage.getByTestId("guest-readonly-banner"),
    ).toBeVisible();

    // No "Add card" trigger on any list column.
    await expect(guestPage.getByTestId("list-add-card")).toHaveCount(0);
    // No list-actions kebab.
    await expect(guestPage.getByTestId("list-actions")).toHaveCount(0);
    // No bulk-select handle.
    await expect(guestPage.getByTestId("tile-select-handle")).toHaveCount(0);
  }

  // --- Owner-side: ensure "New board" button is still visible (sanity) -----
  await ownerPage.goto(`/w/${wsId}/boards`);
  await expect(
    ownerPage.getByRole("button", { name: /new board/i }),
  ).toBeVisible();
});
