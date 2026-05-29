import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

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

describe("workspace_invitations table + RLS", () => {
  it("admin can insert/select; non-member cannot select; pending is unique", async () => {
    const a = await makeUser(`inv-a-${Date.now()}@x.io`);
    const b = await makeUser(`inv-b-${Date.now()}@x.io`);
    const aCli = userClient(a.jwt);
    const bCli = userClient(b.jwt);

    const { data: ws } = await aCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `pending-${Date.now()}@gmail.com`;

    const { error: insErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(insErr).toBeNull();

    const { data: aSees } = await aCli
      .from("workspace_invitations")
      .select("email,status")
      .eq("workspace_id", wsId);
    expect(aSees?.some((r) => r.email === email)).toBe(true);

    const { data: bSees } = await bCli
      .from("workspace_invitations")
      .select("email")
      .eq("workspace_id", wsId);
    expect(bSees?.length ?? 0).toBe(0);

    const { error: dupErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(dupErr).not.toBeNull();
  });
});
