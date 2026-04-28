import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("RLS on workspaces", () => {
  it("non-member cannot see another user's workspace", async () => {
    const a = await makeUser(`a-${Date.now()}@x.io`);
    const b = await makeUser(`b-${Date.now()}@x.io`);

    const aClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${a.jwt}` } },
      auth: { persistSession: false },
    });
    const bClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${b.jwt}` } },
      auth: { persistSession: false },
    });

    const { data: aOwn } = await aClient.from("workspaces").select("id,name");
    expect(aOwn?.length).toBe(1);

    const { data: bSeesA } = await bClient.from("workspaces").select("id,name");
    const aId = aOwn![0].id;
    expect(bSeesA?.find(w => w.id === aId)).toBeUndefined();
  });
});
