import { describe, it, expect, vi, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data } = await service.auth.admin.createUser({ email, password: "passw0rd!", email_confirm: true });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}
function userClient(jwt: string) {
  return createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
}

// Import the real service-role module so we can spy on just inviteUserByEmail,
// leaving auth.getUser (used by dbAsUser's token-verify path) fully functional.
import * as serviceRoleModule from "@/lib/supabase/service-role";
import { inviteMemberImpl } from "@/actions/workspace-members";

describe("invite race recovery (#K2)", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("falls back to direct-add when the email registers mid-flight", async () => {
    const owner = await makeUser(`k2-own-${Date.now()}@x.io`);
    const { data: ws } = await userClient(owner.jwt).from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `k2-race-${Date.now()}@gmail.com`;

    // Get the real client and spy directly on inviteUserByEmail so all other
    // methods (auth.getUser, auth.admin.getUserById, etc.) remain functional.
    const realSb = serviceRoleModule.getServiceSupabase();
    const spy = vi.spyOn(realSb.auth.admin, "inviteUserByEmail").mockImplementationOnce(
      async (inviteEmail: string) => {
        // Mid-flight: create the user so the retry find_user_id_by_email resolves,
        // then return the "already registered" error to trigger the recovery branch.
        // Use email_confirm: false so the on_auth_user_confirmed UPDATE trigger
        // does not immediately flip our pending invitation to "accepted", which
        // would prevent the recovery code from revoking it.  The user just
        // needs to exist so find_user_id_by_email resolves.
        await service.auth.admin.createUser({
          email: inviteEmail,
          email_confirm: false,
          password: "passw0rd!",
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { data: { user: null }, error: { message: "User already registered", code: "email_exists" } } as any;
      },
    );

    try {
      const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
      expect(res.kind).toBe("added");

      const { data: mem } = await service
        .from("workspace_members").select("user_id").eq("workspace_id", wsId).eq("user_id", res.userId);
      expect(mem?.length).toBe(1);
      const { data: inv } = await service
        .from("workspace_invitations").select("status").eq("workspace_id", wsId).eq("email", email).single();
      expect(inv!.status).toBe("revoked");
    } finally {
      spy.mockRestore();
    }
  });
});
