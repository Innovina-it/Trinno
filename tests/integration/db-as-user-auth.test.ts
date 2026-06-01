import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { StructuredError } from "@/lib/errors";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

// Tamper with a JWT's payload (the `sub`) WITHOUT re-signing it.
function tamperSub(jwt: string, newSub: string): string {
  const [h, p, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  claims.sub = newSub;
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${forged}.${sig}`;
}

async function expectUnauthenticated(p: Promise<unknown>) {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(StructuredError);
  expect((caught as StructuredError).code).toBe("UNAUTHENTICATED");
}

describe("dbAsUser — token verification", () => {
  it("accepts a genuine, signed-in token (regression)", async () => {
    const a = await makeUser("auth-ok");
    const rows = await dbAsUser(a.jwt, async (tx) =>
      tx.select().from(workspaces),
    );
    // handle_new_user seeds a personal workspace owned by the caller.
    expect(rows[0].ownerId).toBe(a.id);
  });

  it("rejects a token whose payload was tampered (bad signature)", async () => {
    const victim = await makeUser("auth-victim");
    const attacker = await makeUser("auth-attacker");
    // Attacker rewrites their own token's `sub` to impersonate the victim.
    // Signature no longer matches → GoTrue rejects.
    const forged = tamperSub(attacker.jwt, victim.id);
    await expectUnauthenticated(
      dbAsUser(forged, async (tx) => tx.select().from(workspaces)),
    );
  });

  it("rejects a structurally-bogus token", async () => {
    await expectUnauthenticated(
      dbAsUser(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.notarealsignature",
        async (tx) => tx.select().from(workspaces),
      ),
    );
  });

  it("rejects an expired token", async () => {
    // Hand-craft an unsigned JWT with an `exp` in the past. GoTrue rejects
    // it on both expiry and signature grounds.
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "00000000-0000-0000-0000-000000000000",
        role: "authenticated",
        exp: 1,
      }),
    ).toString("base64url");
    await expectUnauthenticated(
      dbAsUser(`${header}.${payload}.x`, async (tx) =>
        tx.select().from(workspaces),
      ),
    );
  });
});
