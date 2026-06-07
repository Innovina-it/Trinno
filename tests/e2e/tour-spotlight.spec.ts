// E2E test bed for the rewritten first-run tour (components/onboarding/
// tour-overlay.tsx). Proves the redo's whole point: each anchored step's
// spotlight actually lands on the real control it describes, instead of a
// fixed screen corner.
//
// Fixture note: a real self-signup runs the demo seed (mode "1"), which now
// leaves profiles.onboarding_completed_at null (actions/seed.ts) so the tour
// shows on the genuine first-login path. Auth/seed pattern mirrors
// roadmap-completion.spec.ts. (e2e specs that want a tour-free fixture seed
// with mode "minimal", which still marks onboarding complete.)
//
// Robustness note: the tour is a long-lived client component walked over
// several steps. In dev, Next.js Fast Refresh (triggered when the file watcher
// sees churn — e.g. Playwright clearing test-results, or any save) pushes an
// HMR update that resets React state, sending the tour back to step 1
// mid-walk. We therefore drive by STEP NUMBER (click Next until the target
// step is shown) rather than assuming each click advances exactly once, so a
// reset just means a few extra Next clicks instead of a false failure. The
// click mechanics themselves are sound (verified independently).

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const SHOT_DIR = "/tmp/tour-shots"; // outside the project tree (unwatched)

// In dev, Next.js Fast Refresh can reset the tour's client state mid-walk (see
// the robustness note above). gotoStep() absorbs a reset during navigation; a
// reset landing *during* a per-step spotlight assertion is rarer — retries heal
// it. This mirrors the existing harness's dev-mode retry convention
// (gotoWithRetry / ERR_ABORTED in invitations.spec.ts, baselines.spec.ts).
test.describe.configure({ retries: 2 });

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const txt = readFileSync(".env.local", "utf8");
  const m = txt.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in env or .env.local");
  return m[1].trim().replace(/^"|"$/g, "");
}

// markOnboardingCompleted is fire-and-forget (the overlay closes optimistically
// before the server write commits). Poll the DB so the no-return reload check
// doesn't race ahead of the write on a cold run.
async function waitForOnboardingSet(email: string) {
  const sql = postgres(databaseUrl(), { max: 1 });
  try {
    await expect
      .poll(
        async () => {
          const rows = await sql`
            select p.onboarding_completed_at as ts
              from public.profiles p
              join auth.users u on u.id = p.id
             where u.email = ${email}`;
          return rows[0]?.ts ? "set" : "null";
        },
        { timeout: 15_000, intervals: [200, 400] },
      )
      .toBe("set");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function signup(page: Page): Promise<{ wsId: string; email: string }> {
  const email = `tour-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
  await page.context().addCookies([
    { name: "tr_seed_demo", value: "1", domain: "localhost", path: "/" },
  ]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const wsId = page.url().match(/\/w\/([0-9a-f-]{36})/)![1];
  return { wsId, email };
}

async function openTour(page: Page): Promise<{ wsId: string; email: string }> {
  // A plain demo signup (mode "1") now lands with onboarding still null — the
  // demo seed no longer auto-completes it (actions/seed.ts) — so the tour
  // shows on the real self-signup path with no DB manipulation. This asserts
  // the production "all new users see the tour" behavior end-to-end.
  const { wsId, email } = await signup(page);
  await page.goto(`/w/${wsId}/roadmap`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 20_000 });
  return { wsId, email };
}

async function currentStep(page: Page): Promise<number> {
  const txt = await page
    .getByTestId("tour-overlay")
    .locator("text=/STEP \\d+ \\/ \\d+/")
    .innerText()
    .catch(() => "");
  return Number(txt.match(/STEP (\d+)/)?.[1] ?? 0);
}

// Drive to a given step by clicking Next until we get there. Tolerant of a
// Fast Refresh reset to step 1 (just keeps advancing).
async function gotoStep(page: Page, target: number) {
  const tour = page.getByTestId("tour-overlay");
  await expect
    .poll(
      async () => {
        const cur = await currentStep(page);
        if (cur > 0 && cur < target) {
          await tour.getByRole("button", { name: /^next$/i }).click().catch(() => {});
        }
        return cur;
      },
      { timeout: 30_000, intervals: [150, 250, 400] },
    )
    .toBe(target);
}

// Assert the target element's center sits inside the spotlight box — the redo's
// core promise: it points at the right area.
async function expectSpotlightOn(page: Page, targetTestId: string) {
  const spot = page.getByTestId("tour-spotlight");
  await expect(spot).toBeVisible();
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible();

  const sb = await spot.boundingBox();
  const tb = await target.boundingBox();
  expect(sb, "spotlight box").toBeTruthy();
  expect(tb, `target ${targetTestId} box`).toBeTruthy();
  const tcx = tb!.x + tb!.width / 2;
  const tcy = tb!.y + tb!.height / 2;
  expect(tcx).toBeGreaterThanOrEqual(sb!.x - 1);
  expect(tcx).toBeLessThanOrEqual(sb!.x + sb!.width + 1);
  expect(tcy).toBeGreaterThanOrEqual(sb!.y - 1);
  expect(tcy).toBeLessThanOrEqual(sb!.y + sb!.height + 1);
}

test("first-run tour spotlights the real controls it describes", async ({ page }) => {
  const { email } = await openTour(page);
  const tour = page.getByTestId("tour-overlay");
  const shot = (name: string) =>
    page.screenshot({ path: `${SHOT_DIR}/${name}.png` }).catch(() => {});

  // Step 1 — Welcome (centered, no spotlight)
  await gotoStep(page, 1);
  await expect(tour.getByText(/Welcome to Trinno/i)).toBeVisible();
  await expect(page.getByTestId("tour-spotlight")).toHaveCount(0);
  await shot("01-welcome");

  // Step 2 — Workspace switcher
  await gotoStep(page, 2);
  await expect(tour.getByText(/Switch workspaces here/i)).toBeVisible();
  await expectSpotlightOn(page, "workspace-switcher-trigger");
  await shot("02-switcher");

  // Step 3 — Boards
  await gotoStep(page, 3);
  await expect(tour.getByText(/Boards hold your work/i)).toBeVisible();
  await expectSpotlightOn(page, "nav-boards");
  await shot("03-boards");

  // Step 4 — Roadmap
  await gotoStep(page, 4);
  await expect(tour.getByText(/Roadmap is your timeline/i)).toBeVisible();
  await expectSpotlightOn(page, "nav-roadmap");
  await shot("04-roadmap");

  // Step 5 — Search / command palette
  await gotoStep(page, 5);
  await expect(tour.getByText(/Search jumps anywhere/i)).toBeVisible();
  await expectSpotlightOn(page, "palette-trigger");
  await shot("05-search");

  // Finish closes the tour for good (records onboarding completion).
  await tour.getByRole("button", { name: /^finish$/i }).click();
  await expect(tour).toBeHidden({ timeout: 10_000 });

  // The completion write is fire-and-forget; wait for it to land before
  // reloading so the no-return check doesn't race it.
  await waitForOnboardingSet(email);

  // Reload: tour must not return (onboarding flag now set).
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
});

test("narrow viewport falls back to a centered card with no broken arrow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 }); // primary nav hidden < lg
  await openTour(page);

  // The Boards step's target (nav-boards) is hidden behind the hamburger at
  // this width, so it must fall back to centered (no spotlight) rather than
  // point at empty space.
  await gotoStep(page, 3);
  await expect(page.getByTestId("tour-overlay").getByText(/Boards hold your work/i)).toBeVisible();
  await expect(page.getByTestId("tour-spotlight")).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/mobile-boards-centered.png` }).catch(() => {});
});
