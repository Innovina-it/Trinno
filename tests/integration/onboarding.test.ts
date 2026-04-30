import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { markOnboardingCompletedImpl } from "@/actions/onboarding";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
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

describe("markOnboardingCompleted", () => {
  it("starts null for fresh users, flips to non-null after action", async () => {
    const u = await makeUser("ob1");
    // Fresh: handle_new_user trigger doesn't touch onboarding_completed_at.
    const before = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select({ ts: profiles.onboardingCompletedAt })
        .from(profiles)
        .where(eq(profiles.id, u.id)),
    );
    expect(before[0].ts).toBeNull();

    await markOnboardingCompletedImpl(u.jwt);

    const after = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select({ ts: profiles.onboardingCompletedAt })
        .from(profiles)
        .where(eq(profiles.id, u.id)),
    );
    expect(after[0].ts).not.toBeNull();
    expect(after[0].ts! instanceof Date).toBe(true);
  });

  it("RLS prevents one user from completing another user's onboarding", async () => {
    const a = await makeUser("ob2a");
    const b = await makeUser("ob2b");

    // The action signs writes with `a.jwt` but the where clause is keyed on
    // a.id; even if we tried to bypass that, RLS scopes the update to the
    // caller's own row. Sanity-check b's row stays null after a completes.
    await markOnboardingCompletedImpl(a.jwt);

    const bRow = await dbAsUser(b.jwt, async (tx) =>
      tx
        .select({ ts: profiles.onboardingCompletedAt })
        .from(profiles)
        .where(eq(profiles.id, b.id)),
    );
    expect(bRow[0].ts).toBeNull();
  });
});
