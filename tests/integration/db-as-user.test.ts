import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

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

describe("dbAsUser", () => {
  it("queries through Drizzle respect RLS", async () => {
    const a = await makeUser(`d-${Date.now()}@x.io`);
    const rows = await dbAsUser(a.jwt, async (tx) =>
      tx.select().from(workspaces)
    );
    expect(rows.length).toBe(1);
    expect(rows[0].ownerId).toBe(a.id);
  });
});
