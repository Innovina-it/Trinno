import { chromium, request as pwRequest } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";
const APP = "http://localhost:3000";
const OUT = "/tmp/screens";

async function fetchConfirmLink(email) {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (list.ok()) {
      const data = await list.json();
      if (data.messages?.length) {
        const detail = await api.get(`/api/v1/message/${data.messages[0].ID}`);
        const msg = await detail.json();
        const body = msg.HTML || msg.Text || "";
        const m =
          body.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ??
          body.match(/(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no email");
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${APP}/login`);
await page.screenshot({ path: `${OUT}/01-login.png`, fullPage: false });

await page.goto(`${APP}/signup`);
await page.screenshot({ path: `${OUT}/02-signup.png`, fullPage: false });

const email = `view-${Date.now()}@example.com`;
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("passw0rd!");
await page.getByRole("button", { name: /sign up/i }).click();
await page.getByText(/check your email/i).waitFor();
await page.screenshot({ path: `${OUT}/03-signup-sent.png` });

const link = await fetchConfirmLink(email);
await page.goto(link);
await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
await page.screenshot({ path: `${OUT}/04-workspace-empty.png` });

// New board
await page.getByRole("button", { name: /new board/i }).click();
await page.getByLabel("Title").fill("Sprint One");
await page.screenshot({ path: `${OUT}/05-create-board-dialog.png` });
await page.getByRole("button", { name: /create board/i }).click();
await page.waitForURL(/\/b\/[0-9a-f-]{36}/);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/06-board-empty.png` });

// Add list
await page.getByText("+ Add a list").click();
await page.getByPlaceholder("List title").fill("To do");
await page.getByRole("button", { name: /^add list$/i }).click();
await page.getByText("+ Add a list").click();
await page.getByPlaceholder("List title").fill("In progress");
await page.getByRole("button", { name: /^add list$/i }).click();
await page.getByText("+ Add a list").click();
await page.getByPlaceholder("List title").fill("Done");
await page.getByRole("button", { name: /^add list$/i }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/07-board-with-lists.png` });

// Add cards
const todo = page.locator("[data-list-id]").filter({ hasText: "To do" }).first();
await todo.getByText("+ Add a card").click();
await todo.getByPlaceholder("Card title").fill("Wire Stripe webhooks");
await todo.getByRole("button", { name: /^add$/i }).click();
await todo.getByText("+ Add a card").click();
await todo.getByPlaceholder("Card title").fill("Refactor auth middleware");
await todo.getByRole("button", { name: /^add$/i }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/08-board-with-cards.png` });

// Open card modal
await page.getByText("Wire Stripe webhooks").click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/09-card-modal.png` });

await browser.close();
console.log("done →", OUT);
