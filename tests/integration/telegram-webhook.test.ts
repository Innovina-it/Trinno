import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { POST } from "@/app/api/telegram/webhook/route";
import { telegramLinker } from "@/lib/notifications/channels/telegram/linker";

// Local Supabase must be running with creds in .env.local. We exercise the
// inbound webhook (auth + link completion) and the linker's start/persist
// invariants against the real DB via the service role.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function makeUser(prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user create failed");
  return data.user.id;
}

function webhookReq(body: unknown, secret: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function readLink(userId: string) {
  const { data } = await service
    .from("user_channel_links")
    .select("status, external_id, link_token_hash, link_token_exp")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .maybeSingle();
  return data;
}

// Reads the link row INCLUDING the handle column added by migration 0127.
// Used only by the handle-capture test, which is skipped until 0127 is applied
// (selecting an unknown column would otherwise error against the un-migrated
// DB). See the it.skip note below.
async function readLinkWithHandle(userId: string) {
  const { data } = await service
    .from("user_channel_links")
    .select("status, external_id, handle")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .maybeSingle();
  return data as
    | { status: string; external_id: string | null; handle: string | null }
    | null;
}

describe("telegram webhook + linker", () => {
  it("rejects missing secret header with 401", async () => {
    const res = await POST(
      webhookReq({ message: { text: "/start x", chat: { id: 1 } } }, null),
    );
    expect(res.status).toBe(401);
  });

  it("rejects wrong secret header with 401", async () => {
    const res = await POST(
      webhookReq(
        { message: { text: "/start x", chat: { id: 1 } } },
        "definitely-wrong",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("startLink builds the t.me deep-link and persists ONLY the hash", async () => {
    const userId = await makeUser("tg-start");
    const { url: deepLink, expiresAt } = await telegramLinker.startLink(userId);

    const m = deepLink.match(/^https:\/\/t\.me\/(.+)\?start=(.+)$/);
    expect(m).not.toBeNull();
    const botUsername = m![1];
    const plaintext = m![2];
    expect(botUsername).toBe(process.env.TELEGRAM_BOT_USERNAME);

    const row = await readLink(userId);
    expect(row?.status).toBe("pending");
    // The plaintext token is NEVER stored — only its sha256 hex hash.
    expect(row?.link_token_hash).toBe(sha256hex(plaintext));
    expect(row?.link_token_hash).not.toBe(plaintext);

    // Expiry ~15 min out (allow a generous window for clock + roundtrips).
    const ttlMs = new Date(expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it("happy path: /start <token> flips the row to linked", async () => {
    const userId = await makeUser("tg-link");
    const { url: deepLink } = await telegramLinker.startLink(userId);
    const token = deepLink.split("?start=")[1];

    // unique(channel, external_id) means a prior run that linked chat 123456 to
    // some other test user would (correctly) trip the webhook's collision
    // branch. Clear any stale holder so the card's literal assertion holds.
    await service
      .from("user_channel_links")
      .update({ external_id: null })
      .eq("channel", "telegram")
      .eq("external_id", "123456");

    const res = await POST(
      webhookReq(
        { message: { text: `/start ${token}`, chat: { id: 123456 } } },
        SECRET,
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const row = await readLink(userId);
    expect(row?.status).toBe("linked");
    expect(row?.external_id).toBe("123456");
    expect(row?.link_token_hash).toBeNull();
    expect(row?.link_token_exp).toBeNull();
    // NB: the confirmation sendMessage hits the real Telegram API with a fake
    // chat id and fails gracefully; we assert the LINK only, not delivery.
  });

  // UNVERIFIED until migration 0127 (user_channel_links.handle) is applied.
  // The orchestrator applies migrations, not the test suite, so this is
  // it.skip here. Once 0127 is live, change to `it(` and run: the webhook must
  // persist message.from.username into the handle column on link completion,
  // and store null when the sender has no username.
  //
  // NOTE: once 0127 is applied, the webhook's link-completion UPDATE (which now
  // writes `handle`) succeeds; until then that UPDATE errors on the unknown
  // column, so the OTHER link tests in this file also require 0127. See the
  // report's "not verified" section.
  it("happy path: persists message.from.username into the handle column", async () => {
    const userId = await makeUser("tg-handle");
    const { url: deepLink } = await telegramLinker.startLink(userId);
    const token = deepLink.split("?start=")[1];

    await service
      .from("user_channel_links")
      .update({ external_id: null })
      .eq("channel", "telegram")
      .eq("external_id", "123457");

    const res = await POST(
      webhookReq(
        {
          message: {
            text: `/start ${token}`,
            chat: { id: 123457 },
            from: { username: "alice_handle" },
          },
        },
        SECRET,
      ),
    );
    expect(res.status).toBe(200);

    const row = await readLinkWithHandle(userId);
    expect(row?.status).toBe("linked");
    expect(row?.handle).toBe("alice_handle");
  });

  it("happy path: stores null handle when the sender has no username", async () => {
    const userId = await makeUser("tg-handle-null");
    const { url: deepLink } = await telegramLinker.startLink(userId);
    const token = deepLink.split("?start=")[1];

    await service
      .from("user_channel_links")
      .update({ external_id: null })
      .eq("channel", "telegram")
      .eq("external_id", "123458");

    const res = await POST(
      webhookReq(
        {
          // No `from.username` → handle must persist as null.
          message: { text: `/start ${token}`, chat: { id: 123458 } },
        },
        SECRET,
      ),
    );
    expect(res.status).toBe(200);

    const row = await readLinkWithHandle(userId);
    expect(row?.status).toBe("linked");
    expect(row?.handle).toBeNull();
  });

  it("expired token leaves the row unlinked", async () => {
    const userId = await makeUser("tg-exp");
    const token = randomBytes(16).toString("base64url");
    const hash = sha256hex(token);
    // Seed a pending row whose token already expired.
    const { error } = await service.from("user_channel_links").upsert(
      {
        user_id: userId,
        channel: "telegram",
        external_id: null,
        link_token_hash: hash,
        link_token_exp: new Date(Date.now() - 60_000).toISOString(),
        status: "pending",
        linked_at: null,
      },
      { onConflict: "user_id,channel" },
    );
    expect(error).toBeNull();

    const res = await POST(
      webhookReq(
        { message: { text: `/start ${token}`, chat: { id: 654321 } } },
        SECRET,
      ),
    );
    expect(res.status).toBe(200);

    const row = await readLink(userId);
    expect(row?.status).toBe("pending");
    expect(row?.external_id).toBeNull();
    // Token hash untouched (the webhook only mutates a matching, non-expired row).
    expect(row?.link_token_hash).toBe(hash);
  });

  it("chat already linked to another user trips the collision branch (still 200, not linked)", async () => {
    // userA owns chat 777001.
    const userA = await makeUser("tg-colA");
    const tokA = (await telegramLinker.startLink(userA)).url.split("?start=")[1];
    await service
      .from("user_channel_links")
      .update({ external_id: null })
      .eq("channel", "telegram")
      .eq("external_id", "777001");
    const resA = await POST(
      webhookReq(
        { message: { text: `/start ${tokA}`, chat: { id: 777001 } } },
        SECRET,
      ),
    );
    expect(resA.status).toBe(200);

    // userB tries to claim the SAME chat 777001 -> unique(channel, external_id)
    // violation. Webhook must NOT throw, returns 200, leaves B unlinked.
    const userB = await makeUser("tg-colB");
    const tokB = (await telegramLinker.startLink(userB)).url.split("?start=")[1];
    const resB = await POST(
      webhookReq(
        { message: { text: `/start ${tokB}`, chat: { id: 777001 } } },
        SECRET,
      ),
    );
    expect(resB.status).toBe(200);

    const rowB = await readLink(userB);
    expect(rowB?.status).toBe("pending");
    expect(rowB?.external_id).toBeNull();
  });

  it("non-/start updates are ignored with 200", async () => {
    const res = await POST(
      webhookReq({ message: { text: "hello", chat: { id: 9 } } }, SECRET),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
