import { test, expect, type Page } from "@playwright/test";

// Each test does a fresh seeded signup (slow on a cold dev server: the seed
// creates a board + sprint + cards + dashboard) plus one or two roadmap
// reopens. Give the suite room beyond the 60s global default so cold-compile
// + seed latency doesn't trip the timeout before the behavior is reached.
test.describe.configure({ timeout: 120_000 });

// Behavioral e2e for the card quick-view's DEFERRED subtask creation.
//
// The quick view (open by clicking a card tile / roadmap bar) queues a typed
// subtask as a PENDING draft row instead of writing to the server. The footer
// Close button morphs into "Save"; Save persists every queued draft as a real
// subtask. Dismissing through the dirty guard (Back / Esc) and choosing
// Discard drops the drafts without writing them.
//
// Auth/seed + open gesture mirror card-quick-view-back.spec.ts exactly:
// signup with an @innovina.it email (local signup rejects example.com), the
// demo seed checkbox stays checked so the landing roadmap has boards + cards,
// and the quick view is opened by clicking the first `[data-card-id]` tile.
//
// Selectors are the committed data-testid hooks:
//  - card-quick-view                      (dialog root)
//  - card-quick-view-add-subtask          (reveal the inline add input)
//  - card-quick-view-subtask-input        (type the title; Enter queues it)
//  - card-quick-view-subtask-draft-row    (PENDING draft row, not persisted)
//  - card-quick-view-subtask-draft-remove (drop a single draft)
//  - card-quick-view-close                (footer morph: data-dirty + Save)
//  - card-quick-view-subtask-row          (persisted subtask row)
//  - card-quick-view-confirm-prompt / -discard (dirty-guard confirm phase)

// Next.js dev-mode streams RSC; a cold-compile of a route can ERR_ABORTED the
// first navigation. Retry once (mirrors gotoWithRetry in links.spec.ts).
async function gotoWithRetry(page: Page, url: string) {
  await page.goto(url).catch(async (e) => {
    if ((e as Error).message?.includes("ERR_ABORTED")) {
      await page.goto(url);
    } else {
      throw e;
    }
  });
}

async function signupSeeded(page: Page): Promise<string> {
  const email = `qvsd-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  // Submit once. The form sets `tr_seed_demo=1` (seed checkbox defaults on) and
  // navigates through /auth/callback, which runs the demo seed server-side
  // before redirecting to the workspace root (`/w/<id>`). The seed is slow on a
  // cold dev server, so allow a generous window. Do NOT re-submit: a second
  // signUp with the same email errors (user exists) and never navigates. Poll
  // the URL with toHaveURL (avoids waitForURL's default `load` wait, which
  // stalls on the RSC-streaming callback — mirrors links.spec.ts's idiom). The
  // redirect to `/roadmap` is inconsistent, so the caller navigates there.
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
}

// Navigate to the seeded roadmap and open a card's quick view. Pass a cardId
// to reopen the SAME card across saves; omit it to open the first tile and
// return its id so callers can reopen it deterministically. Cold dev server:
// the roadmap shell + tiles need a beat to hydrate before a click registers
// (mirrors openQuickView in card-quick-view-back.spec.ts).
async function openCardQuickView(
  page: Page,
  wsId: string,
  cardId?: string,
): Promise<string> {
  // Pin deterministic roadmap query state:
  //  - assignee=all  → defeats the default "Mine" filter that hides seeded
  //    cards (mirrors links.spec.ts's ?assignee=all).
  //  - lanes=assignee → flat per-person lanes. The default `sub_board`
  //    grouping turns a card that owns a sub-board into a collapsible lane
  //    header whose bar click toggles the lane instead of opening the quick
  //    view; pinning a non-sub-board grouping keeps every bar a plain,
  //    qv-opening tile across reopens.
  await gotoWithRetry(
    page,
    `/w/${wsId}/roadmap?assignee=all&lanes=assignee`,
  );
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/roadmap/);
  await expect(page.locator("[data-card-id]").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1200);
  const tile = cardId
    ? page.locator(`[data-card-id="${cardId}"]`).first()
    : page.locator("[data-card-id]").first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  const openedId = (await tile.getAttribute("data-card-id"))!;
  const qv = page.getByTestId("card-quick-view");
  // Dev-mode hydration can swallow the first click on a freshly-navigated
  // roadmap; retry the open until the dialog mounts.
  await expect(async () => {
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    await tile.click();
    await expect(qv).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  return openedId;
}

// Reveal the inline add input, type a title, and queue it (Enter submits the
// add form, which calls onQueueSubtask and keeps the input focused).
async function queueSubtask(page: Page, title: string) {
  await page.getByTestId("card-quick-view-add-subtask").click();
  const input = page.getByTestId("card-quick-view-subtask-input");
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
}

test("typing a subtask queues a PENDING draft (no server write) and dirties the footer", async ({
  page,
}) => {
  const wsId = await signupSeeded(page);
  await openCardQuickView(page, wsId);

  const title = `Draft subtask ${Date.now()}`;
  await queueSubtask(page, title);

  // A PENDING draft row appears with the typed title.
  const draftRow = page.getByTestId("card-quick-view-subtask-draft-row").filter({
    hasText: title,
  });
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText("PENDING");

  // Footer morphed to the dirty/Save state — not yet persisted.
  const closeBtn = page.getByTestId("card-quick-view-close");
  await expect(closeBtn).toHaveAttribute("data-dirty", "true");
  await expect(closeBtn).toHaveText(/save/i);

  // Still a draft, NOT a persisted subtask row (deferred — no server write).
  await expect(
    page.getByTestId("card-quick-view-subtask-row").filter({ hasText: title }),
  ).toHaveCount(0);
});

test("Save persists queued drafts as real subtasks that survive a reopen", async ({
  page,
}) => {
  const wsId = await signupSeeded(page);
  const cardId = await openCardQuickView(page, wsId);

  const title = `Persist subtask ${Date.now()}`;
  await queueSubtask(page, title);
  await expect(
    page.getByTestId("card-quick-view-subtask-draft-row").filter({ hasText: title }),
  ).toBeVisible();

  // Clicking the morphed Save commits the queued draft via onCreateSubtask.
  await page.getByTestId("card-quick-view-close").click();
  await expect(page.getByTestId("card-quick-view")).toHaveCount(0);

  // Reopen the same card — the draft is gone and the subtask is persisted.
  await openCardQuickView(page, wsId, cardId);
  await expect(
    page.getByTestId("card-quick-view-subtask-draft-row").filter({ hasText: title }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("card-quick-view-subtask-row").filter({ hasText: title }),
  ).toBeVisible({ timeout: 15_000 });
});

test("discarding a queued draft does NOT persist it", async ({ page }) => {
  const wsId = await signupSeeded(page);
  const cardId = await openCardQuickView(page, wsId);

  const title = `Discarded subtask ${Date.now()}`;
  await queueSubtask(page, title);
  await expect(
    page.getByTestId("card-quick-view-subtask-draft-row").filter({ hasText: title }),
  ).toBeVisible();

  // Dismiss via the Back control → dirty guard surfaces the confirm phase
  // (does NOT silently drop the draft). Choose Discard.
  await page.getByTestId("card-quick-view-back").click();
  await expect(page.getByTestId("card-quick-view-confirm-prompt")).toBeVisible();
  await page.getByTestId("card-quick-view-discard").click();
  await expect(page.getByTestId("card-quick-view")).toHaveCount(0);

  // Reopen — the discarded draft never became a persisted subtask.
  await openCardQuickView(page, wsId, cardId);
  await expect(
    page.getByTestId("card-quick-view-subtask-row").filter({ hasText: title }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("card-quick-view-subtask-draft-row").filter({ hasText: title }),
  ).toHaveCount(0);
});
