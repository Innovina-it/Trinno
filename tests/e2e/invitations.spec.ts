import { test, expect, type Page } from "@playwright/test";

async function signupOwner(page: Page, email: string): Promise<string> {
  await page.context().addCookies([{ name: "tr_seed_demo", value: "minimal", domain: "localhost", path: "/" }]);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("checkbox").uncheck().catch(() => {});
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  const m = page.url().match(/\/w\/([0-9a-f-]{36})/);
  return m![1];
}

test("owner invites a new external user → pending badge + resend", async ({ page }) => {
  const owner = `inv-own-${Date.now()}@example.com`;
  const wsId = await signupOwner(page, owner);
  const invitee = `inv-ext-${Date.now()}@gmail.com`;
  // The member list renders the local part of the email as displayName
  // (set by the handle_new_user trigger: local_part = split_part(email, '@', 1)).
  const inviteeDisplay = invitee.split("@")[0];

  await page.goto(`/w/${wsId}/settings`);
  await page.getByLabel("Email").fill(invitee);
  await page.getByRole("button", { name: /^invite$/i }).click();

  // Toast confirms the invite was sent (not "Added").
  await expect(page.getByText(/invite sent/i)).toBeVisible({ timeout: 15_000 });

  // Roster shows the pending invitee with the badge + a Resend control.
  // Reload to pick up the server-side re-render after revalidatePath.
  await page.goto(`/w/${wsId}/settings`);
  // The member row shows displayName (local part of email).
  await expect(page.getByText(inviteeDisplay)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/pending · invite sent/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /resend/i })).toBeVisible();
});

test("invitee accepts via email link → sets password → lands in workspace", async ({ page, request }) => {
  const owner = `acc-own-${Date.now()}@example.com`;
  const wsId = await signupOwner(page, owner);
  const invitee = `acc-ext-${Date.now()}@gmail.com`;

  await page.goto(`/w/${wsId}/settings`);
  await page.getByLabel("Email").fill(invitee);
  await page.getByRole("button", { name: /^invite$/i }).click();
  await expect(page.getByText(/invite sent/i)).toBeVisible({ timeout: 15_000 });

  // Pull the invite email from Mailpit and extract the verify link.
  let verifyUrl = "";
  await expect(async () => {
    const list = await request.get("http://localhost:54324/api/v1/messages?limit=30");
    const msgs = (await list.json()).messages ?? [];
    const msg = msgs.find((m: any) => (m.To ?? []).some((t: any) => t.Address === invitee));
    expect(msg, "invite email in Mailpit").toBeTruthy();
    const full = await request.get(`http://localhost:54324/api/v1/message/${msg.ID}`);
    const body = await full.json();
    const html = (body.HTML || body.Text || "").replace(/&amp;/g, "&");
    const found = html.match(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/);
    expect(found, "verify link present").toBeTruthy();
    verifyUrl = found![0];
  }).toPass({ timeout: 15_000 });

  // Pin redirect_to to an absolute, allowed /accept-invite URL (robust whether
  // or not NEXT_PUBLIC_APP_URL is set in the running server's env).
  const u = new URL(verifyUrl);
  u.searchParams.set("redirect_to", "http://localhost:3000/accept-invite");

  await page.context().clearCookies(); // become the invitee, not the owner
  await page.goto(u.toString());
  await expect(page).toHaveURL(/\/accept-invite/, { timeout: 15_000 });
  await page.getByLabel(/password/i).fill("newpass123!");
  await page.getByRole("button", { name: /set password/i }).click();

  // Invitee lands inside the inviting workspace.
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}`), { timeout: 15_000 });
});
