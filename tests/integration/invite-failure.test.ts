import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Force the Supabase admin invite call to FAIL (non-"already-registered"),
// so inviteMemberImpl takes its catch/cleanup path. dbAsUser (real DB) is
// untouched — it uses DATABASE_URL directly, not this client.
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceSupabase: () => ({
    auth: {
      admin: {
        inviteUserByEmail: async () => ({
          data: { user: null },
          error: { message: "boom", code: "unexpected_failure" },
        }),
        getUserById: async () => ({ data: { user: null }, error: null }),
        generateLink: async () => ({ data: null, error: { message: "linkboom" } }),
      },
    },
  }),
  tryGetServiceSupabase: () => null,
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(email: string) {
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
function userClient(jwt: string) {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

import { inviteMemberImpl } from "@/actions/workspace-members";

describe("invite failure cleanup (#A4)", () => {
  it("deletes the pending invitation when the Supabase invite fails (no lingering bypass)", async () => {
    const owner = await makeUser(`f4-own-${Date.now()}@x.io`);
    const { data: ws } = await userClient(owner.jwt).from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `f4-${Date.now()}@gmail.com`;

    await expect(
      inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" }),
    ).rejects.toThrow();

    // No pending invitation may remain — it would keep the domain gate open.
    const { data: inv } = await service
      .from("workspace_invitations")
      .select("id,status")
      .eq("workspace_id", wsId)
      .eq("email", email);
    expect(inv?.length ?? 0).toBe(0);
  });
});
