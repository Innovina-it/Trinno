import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { seedDemoWorkspaceImpl } from "@/actions/seed";

/**
 * Plan errors-onboarding (U4) — verifies that the rich-demo seed now
 * captures per-step failures via seedStep() instead of swallowing them
 * via the deleted safe() helper. The auth callback reads the same
 * failures[] and surfaces the names to the user via the SeedFailureBanner.
 */

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

describe("seedDemoWorkspaceImpl partial-report", () => {
  it("captures comment.* step failures in result.failures (was swallowed by safe)", async () => {
    const u = await makeUser("seed-comments-fail");
    const r = await seedDemoWorkspaceImpl(u.jwt, {
      mode: "rich",
      __testFailStep: "comment.initiative1.kickoff",
    });
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.workspaceId).toBeTruthy();
    const matchedSteps = r.failures
      .filter((f) => f.step === "comment.initiative1.kickoff")
      .map((f) => f.step);
    expect(matchedSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("captures card-link.* step failures in result.failures", async () => {
    const u = await makeUser("seed-link-fail");
    const r = await seedDemoWorkspaceImpl(u.jwt, {
      mode: "rich",
      __testFailStep: "card-link.story0-blocks-init1",
    });
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    expect(
      r.failures.some((f) => f.step === "card-link.story0-blocks-init1"),
    ).toBe(true);
  });

  it("captures watcher.* step failures in result.failures", async () => {
    const u = await makeUser("seed-watch-fail");
    const r = await seedDemoWorkspaceImpl(u.jwt, {
      mode: "rich",
      __testFailStep: "watcher.initiative-0",
    });
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    expect(
      r.failures.some((f) => f.step === "watcher.initiative-0"),
    ).toBe(true);
  });
});
