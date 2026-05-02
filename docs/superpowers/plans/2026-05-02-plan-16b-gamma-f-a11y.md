# Plan #16b-γ-F — A11y + testing infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Wide slice (5 items, ~10 hrs subagent). Items run in two parallel tracks: (a11y) #16, #17, #60 and (testing infra) #58, #59. Subagent should commit per item.

**Scope (5 items from queue):**
- **#16** Screen-reader-friendly Gantt narration: bars, lanes, sprint bands, today line gain accessible names + roles; keyboard parity for the drag interactions.
- **#17** Contrast audit of the mono palette tokens against WCAG AA (and AAA where cheap).
- **#58** Visual regression baseline via Playwright `toHaveScreenshot`.
- **#59** Load test: front-end FPS at 1k bars + back-end k6 against the auth + read endpoints.
- **#60** `@axe-core/playwright` integration: every key page audited in CI.

**Out of scope:**
- Right-to-left layouts.
- Internationalization / locale strings.
- Mobile-touch-specific a11y (the app is desktop-first; mobile handling is its own slice).
- Custom screen-reader instrumentation beyond `aria-*` + `role` attributes.

**Depends on:**
- γ-G drag-first Gantt landed (G1-G7). The harness's drag systems need keyboard parity.
- aggregate-kanban plan landed (DnD card drag → status column needs `KeyboardSensor`).
- existing E2E suite (10 specs in `tests/e2e/`) — visual regression + axe-core extend the same harness.

**Tech Stack additions:**
- `@axe-core/playwright` — runs axe-core inside Playwright contexts and reports violations.
- `k6` — load test driver (stand-alone CLI, doesn't enter package.json; documented in `docs/load-tests/README.md`).
- (no new front-end deps; FPS profiling uses Chrome DevTools traces driven by Playwright's CDP session)

---

## File Structure

**New files:**
- `tests/a11y/axe.spec.ts` — Playwright spec running axe on every key page, asserting 0 critical violations.
- `tests/a11y/sr-roadmap.spec.ts` — narration-shape spec (assertions on `aria-label` text on bars / lanes / sprints / today line).
- `tests/visual/visual.spec.ts` — `toHaveScreenshot` baselines for 6 key pages.
- `tests/visual/baselines/` — committed screenshot baselines (PNG, gitignored beyond a single resolution).
- `docs/a11y/contrast-audit.md` — manual audit results: each token vs background, contrast ratio, pass/fail.
- `docs/load-tests/README.md` — how to run k6 + Chrome trace.
- `docs/load-tests/k6/auth-smoke.js` — k6 script: login + GET /w/[id] + GET /b/[id] + GET /w/[id]/roadmap at increasing concurrency.
- `tests/perf/fps-1k-bars.spec.ts` — Playwright spec that seeds 1000 cards on a roadmap and measures CDP frame timing during a 4-second pan + zoom-cycle. Asserts P95 < 33 ms (≈ 30 fps).
- `lib/a11y/keyboard-helpers.ts` — small helpers: `useArrowNavigation`, `getNarration` (formats a card's bar narration).

**Modified files:**
- `components/roadmap/roadmap-bar.tsx` — `aria-label` template; `tabIndex={0}` so bars are keyboardable; `aria-roledescription="roadmap bar"`.
- `components/roadmap/sprint-overlay.tsx` — `role="img"` + `aria-label` per sprint band.
- `components/roadmap/use-roadmap-drag-harness.ts` — keyboard handlers for arrow-key date adjust on the focused bar; Enter to enter "drag mode"; Esc to exit.
- `components/workspace/all-tasks-view.tsx` — add `useSensor(KeyboardSensor)` to the dnd-kit context. (Forward-reference: aggregate-kanban plan flagged this.)
- `components/board/card-tile.tsx` — `aria-label` improvements (already a `<Link>`, but the chip soup needs `aria-hidden` flags on decorative icons).
- `components/ui/date-picker.tsx` (from γ-E plan) — verify keyboard nav + `aria-expanded` on trigger.
- `playwright.config.ts` — add a `visual` project + per-project snapshot directory.
- `.github/workflows/ci.yml` (or whatever CI lives at) — add `axe` + `visual` jobs (allow visual-regression failures initially).

---

## Decisions (locked)

| Choice | Decision | Why |
|---|---|---|
| Axe rule profile | `wcag2a` + `wcag2aa` only (skip `experimental`, `best-practice` initially) | Minimize false-positive churn; tighten profile after we hit 0 violations. |
| Visual regression scope | 6 pages × 1 viewport (1280×800) | More viewports = quadratic baseline churn. Start narrow. |
| Visual diff threshold | `maxDiffPixels: 200` per page | Tolerance for font-rendering jitter + sub-pixel hover states. |
| Load test driver | k6 | Lightweight, scriptable in JS, sane defaults for ramp/duration. Existing repos use it. |
| FPS measurement | Playwright CDP `Performance.metrics` + `Animation.startTimingTimingFunction` traces | No external tool; runs in CI. |
| Keyboard drag UX | `Enter` to begin keyboard-drag, arrows to move (1 day at a time), Enter to commit, Esc to cancel | Matches Linear / Asana convention; dnd-kit's `KeyboardSensor` is wired but the *aggregate* drag (column-to-column) needs the same gesture. |
| Audit baseline | All current pages must reach `wcag2aa` 0 critical / 0 serious | Don't widen the scope until baseline holds. |

---

## Tasks

### #17 — Contrast audit — 30 min

**File:** `docs/a11y/contrast-audit.md`

The codebase uses CSS custom properties for text + surface colors. Audit each pairing.

#### Step 1 — Enumerate token pairings

Open `app/globals.css` and list every `--fg*` against every `--bg*` / `--surface*`. The actual file has e.g.:

```
--fg, --fg-muted, --fg-faint, --hairline,
--bg-1, --bg-2, --surface, --surface-strong,
```

#### Step 2 — Compute contrast

Use a CLI like `npx pa11y` or just `npx contrast-checker`. For each pairing produce a row:

| Token pair | Hex (resolved) | Ratio | Status |
|---|---|---|---|
| --fg on --bg-1 | #fafafa on #0a0a0a | 19.4 | ✅ AAA |
| --fg-muted on --bg-1 | #b3b3b3 on #0a0a0a | 11.7 | ✅ AAA |
| --fg-faint on --bg-1 | #6e6e6e on #0a0a0a | 5.1 | ✅ AA |
| --fg-faint on --surface | #6e6e6e on #1c1c1c | 4.5 | ✅ AA borderline |
| ... | | | |

Document all pairings under "Pairings". Status column `✅ AAA / ✅ AA / ⚠ AA-text-only / ❌ FAIL`.

#### Step 3 — Fix any failures

If a pairing fails AA: bump the foreground brightness in `globals.css`. Re-run.

The mono-palette is intentionally muted; expect `--fg-faint` + `--surface` to be the closest pair to failing. Adjust if needed.

#### Step 4 — Commit

```
docs(a11y): #17 mono-palette contrast audit (WCAG AA)
```

---

### #16 — Screen-reader Gantt narration — 3 hr

**Files:**
- New: `lib/a11y/keyboard-helpers.ts`
- Modified: `components/roadmap/roadmap-bar.tsx`, `sprint-overlay.tsx`, `use-roadmap-drag-harness.ts`, `mini-map.tsx`
- New: `tests/a11y/sr-roadmap.spec.ts`

#### Step 1 — Narration helper

```ts
// lib/a11y/keyboard-helpers.ts
import type { CardPriority } from "@/components/board/card/priority-picker";

const STATUS_NAMES = {
  todo: "to do",
  in_progress: "in progress",
  review: "in review",
  done: "done",
  blocked: "blocked",
} as const;

const PRIORITY_NAMES: Record<CardPriority, string> = {
  p0: "priority P0 critical",
  p1: "priority P1 high",
  p2: "priority P2 medium",
  p3: "priority P3 low",
  p4: "priority P4 trivial",
};

export function narrateBar(input: {
  title: string;
  startDate: Date | null;
  targetDate: Date | null;
  status: keyof typeof STATUS_NAMES | null;
  priority: CardPriority | null;
  sprintName: string | null;
  storyPoints: number | null;
}): string {
  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : "no date";
  const parts = [
    `Roadmap bar for ${input.title}`,
    `from ${fmt(input.startDate)} to ${fmt(input.targetDate)}`,
  ];
  if (input.status) parts.push(STATUS_NAMES[input.status]);
  if (input.priority) parts.push(PRIORITY_NAMES[input.priority]);
  if (input.sprintName) parts.push(`in sprint ${input.sprintName}`);
  if (typeof input.storyPoints === "number") {
    parts.push(`${input.storyPoints} points`);
  }
  return parts.join(", ");
}

export function narrateSprintBand(input: {
  name: string;
  start: Date | null;
  end: Date | null;
  state: string;
}): string {
  // e.g. "Sprint Q1, May 1 to May 14, planned"
  return `Sprint ${input.name}, ${input.start ? input.start.toDateString() : "?"} to ${input.end ? input.end.toDateString() : "?"}, ${input.state}`;
}
```

Add tests at `tests/unit/a11y-narrate.test.ts` covering:
- All fields present → full narration string.
- Missing dates → "no date".
- No status / priority / sprint → those segments absent.

#### Step 2 — Wire into RoadmapBar

```diff
+ import { narrateBar } from "@/lib/a11y/keyboard-helpers";
  ...
+ const ariaLabel = narrateBar({
+   title: card.title,
+   startDate: card.startDate,
+   targetDate: card.targetDate,
+   status,
+   priority,
+   sprintName,
+   storyPoints: card.storyPoints,
+ });
  <div
    ...
-   aria-label={`Roadmap bar for ${card.title}`}
+   aria-label={ariaLabel}
+   aria-roledescription="roadmap bar"
+   tabIndex={0}
    ...
  >
```

#### Step 3 — Sprint bands

In `components/roadmap/sprint-overlay.tsx`:

```diff
  <div
    data-testid="sprint-overlay-band"
+   role="img"
+   aria-label={narrateSprintBand({ name: s.name, start: s.startDate, end: s.endDate, state: s.state })}
    ...
  />
```

(Even though the band is purely decorative, screen readers benefit from a single concise label per band; the sprint name is information visible only via spatial layout otherwise.)

#### Step 4 — Today line + weekend stripes

Both already `aria-hidden` (decorative). Confirm.

#### Step 5 — Keyboard handlers

Extend the drag harness with keyboard handlers on the focused bar:

```ts
// In useRoadmapDragHarness, expose `onBarKeyDown(e: React.KeyboardEvent, cardId: string)`.

function onBarKeyDown(e, cardId) {
  if (e.target !== e.currentTarget) return;
  const card = storeCardsRef.current.find((c) => c.id === cardId);
  if (!card) return;
  let dx = 0;
  if (e.key === "ArrowLeft") dx = -1;
  else if (e.key === "ArrowRight") dx = 1;
  else if (e.key === "ArrowDown") dx = 7; // jump 1 week forward (Shift handled below)
  else if (e.key === "ArrowUp") dx = -7;
  else if (e.key === "Enter") {
    onOpenCard(cardId, card.boardId);
    e.preventDefault();
    return;
  } else return;
  e.preventDefault();
  const days = e.shiftKey ? dx * 7 : dx; // shift = 1 week / 1 month
  // Shift both edges (move-mode equivalent).
  const newStart = card.startDate ? addDays(card.startDate, days) : null;
  const newTarget = card.targetDate ? addDays(card.targetDate, days) : null;
  if (!newStart || !newTarget) return;
  patchCardInStore(cardId, { startDate: newStart, targetDate: newTarget });
  void updateCard({
    id: cardId,
    startDate: newStart.toISOString(),
    targetDate: newTarget.toISOString(),
  });
  // Optional toast: "Moved 1 day forward" — non-essential.
}
```

Wire on the bar: `onKeyDown={(e) => drag.onBarKeyDown(e, card.id)}`.

#### Step 6 — E2E spec

```ts
// tests/a11y/sr-roadmap.spec.ts
import { test, expect } from "@playwright/test";
import { signupAndLandOnWorkspace, ... } from "../e2e/_helpers"; // duplicate or extract

test("roadmap bar carries narrated aria-label", async ({ page }) => {
  // ... seed: card "Hello" start=May 2 target=May 16, type=story.
  await page.goto(`/w/${workspaceId}/roadmap`);
  const bar = page.getByTestId("roadmap-bar").first();
  const label = await bar.getAttribute("aria-label");
  expect(label).toContain("Roadmap bar for Hello");
  expect(label).toContain("May 2");
  expect(label).toContain("May 16");
});

test("arrow-key on focused bar shifts dates by 1 day", async ({ page }) => {
  // ... seed similar.
  await page.goto(`/w/${workspaceId}/roadmap`);
  const bar = page.getByTestId("roadmap-bar").first();
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  // ... assert post-shift via opening edit-dates; start becomes May 3.
});
```

#### Commit

```
feat(a11y): #16 narrated roadmap bars + keyboard date shift
```

---

### #60 — axe-core integration — 1.5 hr

**Files:**
- New: `tests/a11y/axe.spec.ts`
- Modified: `playwright.config.ts` (add a project), `.github/workflows/*.yml`

#### Step 1 — Add dep

```bash
npm install -D @axe-core/playwright
```

#### Step 2 — Spec

```ts
// tests/a11y/axe.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signupAndLandOnWorkspace } from "../e2e/_helpers";

const PAGES = [
  { path: (ws: string) => `/w/${ws}`, name: "workspace" },
  { path: (ws: string) => `/w/${ws}/roadmap`, name: "roadmap" },
  { path: (ws: string) => `/w/${ws}/backlog`, name: "backlog" },
  { path: (ws: string) => `/w/${ws}/all-tasks`, name: "all-tasks" },
  { path: (ws: string) => `/inbox`, name: "inbox" },
];

test.describe("axe-core a11y", () => {
  for (const p of PAGES) {
    test(`${p.name} has no critical violations`, async ({ page }) => {
      const { workspaceId } = await signupAndLandOnWorkspace(page, "axe");
      await page.goto(p.path(workspaceId));
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const critical = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      expect.soft(critical, `axe violations on ${p.name}: ${JSON.stringify(critical, null, 2)}`).toEqual([]);
    });
  }
});
```

#### Step 3 — Iterate to green

Initial run will fail. Fix violations one by one:
- Missing labels on icon-only buttons → add `aria-label`.
- Form fields without `<label>` → add label or `aria-labelledby`.
- Insufficient contrast (caught by axe) → see #17 audit.
- Heading hierarchy (h1 → h2 → h3) → fix structural violations.

Iterate until all 5 pages have 0 critical / 0 serious.

Per-iteration: commit `fix(a11y): <what you fixed>` so the diff is reviewable.

#### Step 4 — Wire to CI

In `.github/workflows/ci.yml`:

```yaml
  axe:
    runs-on: ubuntu-latest
    needs: [unit]
    steps:
      ... (mirror existing playwright setup)
      - run: npx playwright test tests/a11y/axe.spec.ts
```

#### Commit

```
feat(a11y): #60 axe-core CI on key pages — baseline 0 violations
```

---

### #58 — Visual regression — 2 hr

**Files:**
- New: `tests/visual/visual.spec.ts`
- New: `tests/visual/baselines/` (PNG dir, committed)
- Modified: `playwright.config.ts`, CI

#### Step 1 — Spec

```ts
// tests/visual/visual.spec.ts
import { test, expect } from "@playwright/test";
import { signupAndLandOnWorkspace } from "../e2e/_helpers";

const VIEWPORT = { width: 1280, height: 800 };

const PAGES = [
  { path: (ws: string) => `/w/${ws}`, name: "workspace-grid" },
  { path: (ws: string) => `/w/${ws}/roadmap`, name: "roadmap" },
  { path: (ws: string) => `/w/${ws}/all-tasks`, name: "all-tasks" },
  { path: (ws: string) => `/inbox`, name: "inbox" },
];

test.describe("visual regression", () => {
  test.use({ viewport: VIEWPORT });

  for (const p of PAGES) {
    test(`${p.name} matches baseline`, async ({ page }) => {
      const { workspaceId } = await signupAndLandOnWorkspace(page, "viz");
      await page.goto(p.path(workspaceId));
      // Wait for fonts + images.
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(`${p.name}.png`, {
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    });
  }
});
```

#### Step 2 — Generate baselines

```bash
npx playwright test tests/visual --update-snapshots
```

Commit the resulting PNGs into `tests/visual/baselines/`.

#### Step 3 — CI integration

Add `visual` Playwright project. CI runs the spec; failures upload diff images as artifacts.

In CI, allow visual failures initially (do not block PR merge) — catch trends, tighten later:

```yaml
  visual:
    continue-on-error: true
    runs-on: ubuntu-latest
    needs: [unit]
    steps:
      ...
      - run: npx playwright test tests/visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-diffs
          path: test-results/
```

#### Step 4 — Document

In `docs/a11y/contrast-audit.md` (or new `docs/visual/README.md`), document:
- How to update baselines: `npx playwright test tests/visual --update-snapshots && git add tests/visual/baselines/`.
- When to update: any intentional UI change in the 6 pages.
- Threshold rationale.

#### Commit

```
test(visual): #58 visual regression baseline on 4 key pages
```

---

### #59 — Load test — 3 hr

**Files:**
- New: `docs/load-tests/README.md`, `docs/load-tests/k6/auth-smoke.js`
- New: `tests/perf/fps-1k-bars.spec.ts`

Two tracks: back-end (k6) and front-end (Playwright + CDP frame timing).

#### Track A — Back-end (k6)

##### Step 1 — Install k6

`brew install k6` or download from https://k6.io/docs/get-started/installation/. Doesn't enter `package.json`; document the prereq.

##### Step 2 — k6 script

```js
// docs/load-tests/k6/auth-smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const COOKIE = __ENV.AUTH_COOKIE; // pre-baked SSR cookie from a logged-in browser

export default function () {
  const headers = { Cookie: COOKIE, "Content-Type": "application/json" };
  const ws = __ENV.WORKSPACE_ID;
  const board = __ENV.BOARD_ID;

  const r1 = http.get(`${BASE}/w/${ws}`, { headers });
  check(r1, { "ws 200": (r) => r.status === 200 });

  const r2 = http.get(`${BASE}/b/${board}`, { headers });
  check(r2, { "board 200": (r) => r.status === 200 });

  const r3 = http.get(`${BASE}/w/${ws}/roadmap`, { headers });
  check(r3, { "roadmap 200": (r) => r.status === 200 });

  sleep(1);
}
```

##### Step 3 — Run + capture results

`docs/load-tests/README.md` — explains how to bake an `AUTH_COOKIE`, set `WORKSPACE_ID` / `BOARD_ID`, then `k6 run --env AUTH_COOKIE=...` etc.

#### Track B — Front-end (Playwright FPS)

##### Step 1 — Spec

```ts
// tests/perf/fps-1k-bars.spec.ts
import { test, expect } from "@playwright/test";
import { signupAndLandOnWorkspace } from "../e2e/_helpers";
import { seed1kCards } from "../perf/_seed";

test("roadmap stays above 30 fps with 1000 cards", async ({ page }) => {
  test.setTimeout(180_000);
  const { workspaceId } = await signupAndLandOnWorkspace(page, "perf");
  await seed1kCards(page, workspaceId);
  await page.goto(`/w/${workspaceId}/roadmap`);
  await page.waitForLoadState("networkidle");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  // Pan + zoom-cycle for 4 s.
  const start = Date.now();
  while (Date.now() - start < 4000) {
    await page.mouse.wheel(50, 0); // horizontal pan
    await page.waitForTimeout(16);
  }
  const metrics = await cdp.send("Performance.getMetrics");
  const frames = metrics.metrics.find((m) => m.name === "Frames")?.value ?? 0;
  const elapsed = 4; // s
  const fps = frames / elapsed;
  expect(fps).toBeGreaterThan(30);
});
```

##### Step 2 — Seed helper

`tests/perf/_seed.ts` — uses Drizzle + `dbAsUser` directly to seed 1000 cards with random dates inside the gridded range. Skip the UI; drive insertion via a service-role client to keep the seed cheap.

##### Step 3 — Iterate to green

If FPS < 30 with 1000 bars, profile: `roadmap-view.tsx` likely renders all bars; consider a virtualization pass (out of scope for v1, listed as a follow-up). Document the result honestly even if FPS dips below 30 — flag it in `concerns.md` and let the team decide if virtualization is warranted now.

#### Commit (split into two commits)

```
test(perf): #59 k6 back-end smoke test
test(perf): #59 Playwright FPS-with-1000-bars baseline
```

---

## Verification (run before declaring plan complete)

- [ ] `npx tsc --noEmit`
- [ ] `npm run test:unit`
- [ ] `npm run lint` — no new warnings
- [ ] `npx playwright test tests/a11y` — passes
- [ ] `npx playwright test tests/visual` — passes (or fails with documented diffs uploaded as artifacts)
- [ ] `npx playwright test tests/perf` — passes (or documents regression)
- [ ] `k6 run docs/load-tests/k6/auth-smoke.js --env AUTH_COOKIE=...` — passes thresholds
- [ ] Manual smoke:
  - Tab-key navigate roadmap → bars receive focus, narrated by VoiceOver / NVDA.
  - Arrow keys on focused bar → date shifts by 1 day; Shift+arrow = 1 week.
  - Enter on focused bar → opens card.
  - Inspect axe results manually on `/w/<id>/all-tasks` — 0 critical.
  - Visual baselines committed and reviewed.

---

## Self-Review Notes

- **Spec coverage:** all 5 items have dedicated tasks. Track ordering allows parallel work.
- **New deps:** `@axe-core/playwright` (Playwright dev dep). k6 is external CLI.
- **Bundle delta:** zero — all changes are dev-only or aria attributes (no JS shipped).
- **Performance regressions vs the goal:** the FPS test may fail initially. We chose `> 30 fps` as a hard gate; if real-world performance is below that, the plan exposes it. The "fix" might be virtualizing the bar layer — a sibling slice, not part of γ-F.
- **Visual regression is fragile** by design. We start with allow-failures in CI (`continue-on-error`) and tighten the threshold later. Otherwise every legit UI tweak burns the team on baseline updates.
- **Keyboard drag UX**: arrow keys = 1 day, Shift+arrow = 1 week. We could also add Alt+arrow for resize-only — listed as a v2 polish.
- **Mention popover keyboard nav**: γ-E plan handles it. γ-F just verifies via axe-core that the popover has `role="listbox"` + `aria-activedescendant`.
- **Date picker**: γ-E plan added `<DatePicker>`. γ-F verifies it's keyboard-navigable end-to-end (react-day-picker handles it natively, but axe will catch any missing labels on the trigger).
- **#59 scope tradeoff**: load tests can grow infinitely. We constrain to "log in + GET 3 pages, ramp 5 → 20 VUs over 2 minutes" — not a stress test, but a smoke. Larger campaigns are sibling work.
- **CI cost**: visual + axe + perf adds ~3-4 min to CI runtime. Acceptable for a daily branch cadence; gate on PRs only when stable.

---

## Estimated effort

| Task | Effort |
|---|---|
| #17 — contrast audit | 30 min |
| #16 — SR Gantt narration + keyboard | 3 hr |
| #60 — axe-core CI | 1.5 hr |
| #58 — visual regression baseline | 2 hr |
| #59 — load test (k6 + FPS) | 3 hr |
| **Total** | **~10 hrs** subagent (~1.25 days) |

(Matches the queue's "~10 hrs" estimate.)
