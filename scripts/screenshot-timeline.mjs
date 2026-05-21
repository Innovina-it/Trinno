import { chromium } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 820, height: 1100 },
  { name: "mobile", width: 390, height: 844 },
];

const TIMELINE_URL = "http://localhost:3000/timeline";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addCookies([
  {
    name: "tr_seed_demo",
    value: "1",
    domain: "localhost",
    path: "/",
  },
]);
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.type();
  if (t === "error" || t === "warning") {
    console.log(`[${t}] ${m.text()}`);
  }
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`);
});

const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@innovina.it`;
console.log(`signup as ${email}`);
await page.goto("http://localhost:3000/signup");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("passw0rd!");
try {
  await page.getByRole("checkbox").uncheck({ timeout: 1000 });
} catch {}
await page.getByRole("button", { name: /sign up/i }).click();
await page.waitForURL(/\/w\/[0-9a-f-]{36}/, { timeout: 30000 });

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(TIMELINE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const out = `/tmp/timeline-${vp.name}.png`;
  await page.screenshot({ path: out, fullPage: false });
  console.log(`${vp.name} (${vp.width}x${vp.height}) → ${out}`);

  // Reset gantt scroll to the start of range, then screenshot again so the
  // earliest-scheduled rows lead the frame.
  await page.evaluate(() => {
    const scroller = document.querySelector(
      '[data-testid="common-roadmap-view"] > div:nth-child(2)',
    );
    if (scroller) {
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    }
  });
  await page.waitForTimeout(200);
  const out2 = `/tmp/timeline-${vp.name}-start.png`;
  await page.screenshot({ path: out2, fullPage: false });
  console.log(`${vp.name} start → ${out2}`);
}

await browser.close();
console.log("done");
