// One-off bootstrap: register the Telegram webhook for the bot.
//
// REQUIRES A PUBLIC HTTPS URL. Telegram will only call back to a publicly
// reachable HTTPS endpoint — a LAN address or http://localhost will NOT work.
// In dev, expose your Next server through a tunnel (ngrok / cloudflared) and
// pass that origin:
//
//   node scripts/telegram-set-webhook.mjs https://<your-tunnel>.ngrok-free.app
//
// or set WEBHOOK_URL in the environment instead of argv. The script POSTs to
// setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET; Telegram then echoes
// that secret in the x-telegram-bot-api-secret-token header on every delivery,
// which the /api/telegram/webhook route checks.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (from .env.local / shell).

import { config } from "dotenv";

config({ path: ".env.local" });

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.argv[2] ?? process.env.WEBHOOK_URL;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set.");
  process.exit(1);
}
if (!secret) {
  console.error("TELEGRAM_WEBHOOK_SECRET is not set.");
  process.exit(1);
}
if (!base) {
  console.error(
    "Missing target URL. Pass a PUBLIC HTTPS origin as argv[2] or set WEBHOOK_URL.\n" +
      "  node scripts/telegram-set-webhook.mjs https://<tunnel-host>",
  );
  process.exit(1);
}
if (!/^https:\/\//.test(base)) {
  console.error(
    `Refusing: "${base}" is not https. Telegram requires a public HTTPS URL ` +
      "(use an ngrok/cloudflared tunnel; localhost/LAN will not work).",
  );
  process.exit(1);
}

const webhookUrl = `${base.replace(/\/$/, "")}/api/telegram/webhook`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "my_chat_member"],
  }),
});

const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 1);
