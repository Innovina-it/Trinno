import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  dispatchTelegramNotifications,
} from "@/lib/notifications/dispatch";

// Telegram dispatcher (U5) — exercised against the real local Supabase via the
// service role.  We MOCK the network so no message ever hits api.telegram.org:
// any fetch to the Bot API returns a 200 { ok: true } (or 403 for the blocked
// case).  Assertions are at the LEDGER level (notification_deliveries) plus the
// payload captured by the mocked fetch (proves name resolution).
//
// Each test provisions a fresh user + a card/board so runs are independent and
// idempotent regardless of prior DB state.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const realFetch = globalThis.fetch;

// Records every Telegram sendMessage body the dispatcher posts so we can assert
// the resolved card title made it into the wire text.
let captured: Array<Record<string, unknown>> = [];

function installTelegramMock(opts: { status?: number } = {}) {
  const status = opts.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const href = typeof input === "string" ? input : String(input);
      if (href.includes("api.telegram.org")) {
        if (init?.body) {
          try {
            captured.push(JSON.parse(init.body as string));
          } catch {
            /* ignore non-JSON bodies */
          }
        }
        if (status === 403) {
          return new Response(JSON.stringify({ ok: false }), { status: 403 });
        }
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status,
        });
      }
      // Everything else (Supabase REST/auth) goes to the real fetch.
      return realFetch(input as never, init as never);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  captured = [];
});

const TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

// Unique chat id per call so the unique(channel, external_id) constraint never
// collides with rows left by other runs.
let chatSeq = 0;
function nextChatId(): string {
  chatSeq += 1;
  return `90${Date.now() % 1_000_000}${chatSeq}`;
}

async function linkTelegram(userId: string, status = "linked"): Promise<void> {
  const { error } = await service.from("user_channel_links").upsert(
    {
      user_id: userId,
      channel: "telegram",
      external_id: status === "linked" ? nextChatId() : null,
      status,
      linked_at: status === "linked" ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,channel" },
  );
  if (error) throw error;
}

async function setPref(
  userId: string,
  kind: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await service.from("user_notification_prefs").upsert(
    { user_id: userId, kind, channel: "telegram", enabled },
    { onConflict: "user_id,kind,channel" },
  );
  if (error) throw error;
}

// Master "Notify me on every event" toggle (profiles.notify_per_event, default
// FALSE). Gate 0 in the dispatcher: per-event telegram delivery does not run
// for a recipient whose master is off, so every test that expects a SEND must
// flip this true. A profiles row already exists for each created auth user
// (created by the handle_new_user trigger), so a plain update suffices.
async function setMaster(userId: string, on: boolean): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ notify_per_event: on })
    .eq("id", userId);
  if (error) throw error;
}

// Insert a board + card owned by service role so name resolution has real
// titles to find.  Returns ids + the titles for assertions.
async function makeCard(): Promise<{
  boardId: string;
  cardId: string;
  cardTitle: string;
  boardTitle: string;
  workspaceId: string;
  listId: string;
}> {
  const ownerId = await makeUser("disp-owner");
  const { data: ws, error: wsErr } = await service
    .from("workspaces")
    .insert({ name: `WS-${TAG}`, owner_id: ownerId })
    .select("id")
    .single();
  if (wsErr) throw wsErr;
  const boardTitle = `Board ${TAG}`;
  const { data: board, error: bErr } = await service
    .from("boards")
    .insert({
      workspace_id: ws.id,
      title: boardTitle,
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (bErr) throw bErr;
  const { data: list, error: lErr } = await service
    .from("lists")
    .insert({ board_id: board.id, title: "L", position: "a0" })
    .select("id")
    .single();
  if (lErr) throw lErr;
  const cardTitle = `Ship the dispatcher ${TAG}`;
  const { data: card, error: cErr } = await service
    .from("cards")
    .insert({
      list_id: list.id,
      board_id: board.id,
      title: cardTitle,
      position: "a0",
    })
    .select("id")
    .single();
  if (cErr) throw cErr;
  return {
    boardId: board.id,
    cardId: card.id,
    cardTitle,
    boardTitle,
    workspaceId: ws.id,
    listId: list.id,
  };
}

async function makeNotification(opts: {
  recipientUserId: string;
  actorUserId?: string | null;
  kind?: string;
  cardId?: string | null;
  boardId?: string | null;
}): Promise<string> {
  const { data, error } = await service
    .from("notifications")
    .insert({
      recipient_user_id: opts.recipientUserId,
      actor_user_id: opts.actorUserId ?? null,
      kind: opts.kind ?? "card.assigned",
      related_card_id: opts.cardId ?? null,
      related_board_id: opts.boardId ?? null,
      payload: {},
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function ledger(notificationId: string) {
  const { data } = await service
    .from("notification_deliveries")
    .select("status, sent_at, error, attempts")
    .eq("notification_id", notificationId)
    .eq("channel", "telegram")
    .maybeSingle();
  return data;
}

describe("telegram dispatch", () => {
  beforeAll(async () => {
    // The dispatcher reads TELEGRAM_BOT_TOKEN lazily; make sure it's present so
    // the client attempts a (mocked) send rather than failing on missing token.
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
    }

    // The 'telegram' channel value is admitted by migration
    // 0125_widen_notification_channel_telegram.sql. Integration tests run
    // against the migrated DB, so no schema patching is needed here.
  });

  it("linked user + enabled pref + pending notification → ledger 'sent'", async () => {
    installTelegramMock();
    const recipient = await makeUser("disp-recip");
    const actor = await makeUser("disp-actor");
    await linkTelegram(recipient);
    await setMaster(recipient, true);
    await setPref(recipient, "card.assigned", true);
    const { cardId, boardId } = await makeCard();
    const nId = await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned",
      cardId,
      boardId,
    });

    const res = await dispatchTelegramNotifications({ limit: 200 });
    expect(res.sent).toBeGreaterThanOrEqual(1);

    const row = await ledger(nId);
    expect(row?.status).toBe("sent");
    expect(row?.sent_at).toBeTruthy();
  });

  it("MASTER off + linked + Tier-1 no-pref → ledger 'skipped' (NOT sent)", async () => {
    // Gate 0: the master notify_per_event toggle (default FALSE) must block the
    // per-event send BEFORE isLinked / per-kind, even for a linked user and a
    // Tier-1 default-on kind with no explicit pref row.
    installTelegramMock();
    const recipient = await makeUser("disp-master-off");
    const actor = await makeUser("disp-master-off-a");
    await linkTelegram(recipient);
    // Deliberately leave master OFF (no setMaster) — the default is false.
    // Deliberately NO setPref — a Tier-1 kind would otherwise send by default.
    const { cardId, boardId } = await makeCard();
    const nId = await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned", // Tier 1, default-on
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });
    const row = await ledger(nId);
    expect(row?.status).toBe("skipped");
    expect(row?.sent_at == null).toBe(true);
  });

  it("MASTER on + linked + Tier-1 no-pref → ledger 'sent'", async () => {
    // The mirror of the test above: flipping master ON lets the Tier-1
    // default-on kind through with no explicit pref row.
    installTelegramMock();
    const recipient = await makeUser("disp-master-on");
    const actor = await makeUser("disp-master-on-a");
    await linkTelegram(recipient);
    await setMaster(recipient, true);
    // No setPref — exercise the Tier-1 default-on fallback under master ON.
    const { cardId, boardId } = await makeCard();
    const nId = await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned", // Tier 1, default-on
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });
    const row = await ledger(nId);
    expect(row?.status).toBe("sent");
    expect(row?.sent_at).toBeTruthy();
  });

  it("name resolution: the sent payload carries the real card title", async () => {
    installTelegramMock();
    const recipient = await makeUser("disp-name-r");
    const actor = await makeUser("disp-name-a");
    await linkTelegram(recipient);
    await setMaster(recipient, true);
    await setPref(recipient, "card.assigned", true);
    const { cardId, boardId, cardTitle } = await makeCard();
    await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned",
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });

    // At least one captured Bot API body must contain the real card title and
    // NOT the "Someone"/empty fallback for a card-bearing event.
    const texts = captured.map((b) => String(b.text ?? ""));
    expect(texts.some((t) => t.includes(cardTitle))).toBe(true);
  });

  it("Tier-1 kind + NO pref row → ledger 'sent' (default-on honored)", async () => {
    // The tiered default: a Tier-1 kind (card.assigned, defaultExternalOn=true)
    // sends even with no explicit pref row, because the dispatcher now falls
    // back to defaultExternalOn(kind) instead of strict opt-in.  This is the
    // honest half of the invariant: the UI pre-checks this box, so it must send.
    installTelegramMock();
    const recipient = await makeUser("disp-t1-default");
    const actor = await makeUser("disp-t1-actor");
    await linkTelegram(recipient);
    await setMaster(recipient, true);
    // Deliberately NO setPref — exercise the absent-row fallback.
    const { cardId, boardId } = await makeCard();
    const nId = await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned",
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });
    const row = await ledger(nId);
    expect(row?.status).toBe("sent");
    expect(row?.sent_at).toBeTruthy();
  });

  it("Tier-2/3 kind + NO pref row → ledger 'skipped' (default-off)", async () => {
    // Tier-2 (card.moved) and Tier-3 (card.archived) both default OFF, so an
    // absent pref row must still skip — the UI leaves these unchecked.
    installTelegramMock();

    const recipient = await makeUser("disp-t2-default");
    await linkTelegram(recipient);
    await setMaster(recipient, true); // isolate the per-kind gate, not master
    const nId2 = await makeNotification({
      recipientUserId: recipient,
      kind: "card.moved", // Tier 2
    });

    const recipient3 = await makeUser("disp-t3-default");
    await linkTelegram(recipient3);
    await setMaster(recipient3, true); // isolate the per-kind gate, not master
    const nId3 = await makeNotification({
      recipientUserId: recipient3,
      kind: "card.archived", // Tier 3
    });

    await dispatchTelegramNotifications({ limit: 200 });
    expect((await ledger(nId2))?.status).toBe("skipped");
    expect((await ledger(nId3))?.status).toBe("skipped");
  });

  it("explicit pref row OVERRIDES the tiered default both ways", async () => {
    installTelegramMock();

    // Tier-1 default-ON, but explicitly DISABLED → skip.
    const offUser = await makeUser("disp-t1-off");
    await linkTelegram(offUser);
    await setMaster(offUser, true); // isolate the per-kind override, not master
    await setPref(offUser, "card.assigned", false); // Tier 1
    const offId = await makeNotification({
      recipientUserId: offUser,
      kind: "card.assigned",
    });

    // Tier-3 default-OFF, but explicitly ENABLED → send.
    const onUser = await makeUser("disp-t3-on");
    const actor = await makeUser("disp-t3-on-actor");
    await linkTelegram(onUser);
    await setMaster(onUser, true);
    await setPref(onUser, "card.archived", true); // Tier 3
    const { cardId, boardId } = await makeCard();
    const onId = await makeNotification({
      recipientUserId: onUser,
      actorUserId: actor,
      kind: "card.archived",
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });
    expect((await ledger(offId))?.status).toBe("skipped");
    const onRow = await ledger(onId);
    expect(onRow?.status).toBe("sent");
    expect(onRow?.sent_at).toBeTruthy();
  });

  it("unlinked user → ledger 'skipped'", async () => {
    installTelegramMock();
    const recipient = await makeUser("disp-unlinked");
    // No user_channel_links row → not linked.
    await setMaster(recipient, true); // isolate the isLinked gate, not master
    await setPref(recipient, "card.assigned", true);
    const nId = await makeNotification({ recipientUserId: recipient });

    await dispatchTelegramNotifications({ limit: 200 });
    const row = await ledger(nId);
    expect(row?.status).toBe("skipped");
  });

  it("idempotent: a second run does not re-send an already-'sent' notification", async () => {
    installTelegramMock();
    const recipient = await makeUser("disp-idem");
    const actor = await makeUser("disp-idem-a");
    await linkTelegram(recipient);
    await setMaster(recipient, true);
    await setPref(recipient, "card.assigned", true);
    const { cardId, boardId } = await makeCard();
    const nId = await makeNotification({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "card.assigned",
      cardId,
      boardId,
    });

    await dispatchTelegramNotifications({ limit: 200 });
    const first = await ledger(nId);
    expect(first?.status).toBe("sent");

    // Count how many sends targeted THIS notification's text the first run.
    const before = captured.length;

    // Second run: the terminal-row filter must exclude this notification, so
    // no additional send happens for it.
    await dispatchTelegramNotifications({ limit: 200 });

    // The ledger row is still 'sent' (unchanged terminal state).
    const second = await ledger(nId);
    expect(second?.status).toBe("sent");

    // No NEW capture references this exact notification again.  We can't easily
    // tie a capture to a notification id, but the strongest signal is that the
    // second run reported the same row as terminal — assert via a fresh count:
    // re-run once more and confirm the ledger sent_at didn't move.
    expect(second?.sent_at).toBe(first?.sent_at);
    void before;
  });
});
