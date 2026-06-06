import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

// "Notify me on every event" master toggle — backend (contract §9.1–2).
// docs/features/telegram-channel/U6-MASTER-TOGGLE-CONTRACT.md.
//
// The server actions (getNotifyPerEvent / setNotifyPerEvent) read the caller
// identity through @/lib/auth (cookie-backed in prod). Here we mock auth so
// getSessionToken returns a REAL anon-signed-in JWT for a fresh user — the
// real dbAsUser then runs the query under that user's RLS against the local
// Supabase. revalidatePath is a no-op outside a request.
//
// Mocks must be declared before importing the action module (vitest hoists
// vi.mock; the JWT is supplied per-test via the hoisted holder).

const auth = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ id: "test" })),
  getSessionToken: vi.fn(async () => auth.token),
}));

const { getNotifyPerEvent, setNotifyPerEvent } = await import(
  "@/actions/user-notification-prefs"
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function readPersisted(userId: string): Promise<boolean> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const rows = await sql.unsafe(
      `select notify_per_event from public.profiles where id = '${userId}'`,
    );
    return Boolean((rows[0] as { notify_per_event?: boolean })?.notify_per_event);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Create a fresh confirmed user, sign in to get a real access token, and seed
// the required profiles row (the app normally provisions it via a trigger;
// upsert keeps the test self-contained).
async function makeUser(prefix: string): Promise<{ id: string; jwt: string }> {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user create failed");
  const id = data.user.id;
  await service.from("profiles").upsert(
    { id, display_name: prefix, handle: `${prefix}-${id.slice(0, 8)}` },
    { onConflict: "id" },
  );
  const { data: s, error: sErr } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  if (sErr || !s.session) throw sErr ?? new Error("sign-in failed");
  return { id, jwt: s.session.access_token };
}

let chatSeq = 0;
async function linkTelegram(userId: string): Promise<void> {
  chatSeq += 1;
  const { error } = await service.from("user_channel_links").upsert(
    {
      user_id: userId,
      channel: "telegram",
      external_id: `91${Date.now() % 1_000_000}${chatSeq}`,
      status: "linked",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,channel" },
  );
  if (error) throw error;
}

describe("notify-per-event master toggle (backend)", () => {
  it("defaults false for a fresh user (§9.1)", async () => {
    const { id, jwt } = await makeUser("npe-default");
    auth.token = jwt;
    expect(await getNotifyPerEvent()).toBe(false);
    expect(await readPersisted(id)).toBe(false);
  });

  it("setNotifyPerEvent(true) with NO channel throws; stays false (§9.2)", async () => {
    const { id, jwt } = await makeUser("npe-guard");
    auth.token = jwt;
    await expect(setNotifyPerEvent(true)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "No delivery channel connected",
    });
    // Guard fired before any write — the column must remain false.
    expect(await readPersisted(id)).toBe(false);
    expect(await getNotifyPerEvent()).toBe(false);
  });

  it("with a linked telegram channel: enables, persists, on→off→on (§9.3)", async () => {
    const { id, jwt } = await makeUser("npe-linked");
    await linkTelegram(id);
    auth.token = jwt;

    await setNotifyPerEvent(true);
    expect(await readPersisted(id)).toBe(true);
    expect(await getNotifyPerEvent()).toBe(true);

    await setNotifyPerEvent(false);
    expect(await readPersisted(id)).toBe(false);
    expect(await getNotifyPerEvent()).toBe(false);

    await setNotifyPerEvent(true);
    expect(await readPersisted(id)).toBe(true);
    expect(await getNotifyPerEvent()).toBe(true);
  });
});
