import { afterAll, describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const sql = postgres(process.env.DATABASE_URL!);

afterAll(async () => {
  await sql.end();
});

describe("profile trigger", () => {
  it("creates profile and default workspace on signup", async () => {
    const email = `t-${Date.now()}@example.com`;
    const { data, error } = await supa.auth.admin.createUser({
      email, password: "passw0rd!", email_confirm: true,
    });
    expect(error).toBeNull();
    const uid = data.user!.id;

    const profile = await sql`select display_name from profiles where id = ${uid}`;
    expect(profile[0].display_name).toBe(email.split("@")[0]);

    const ws = await sql`
      select w.name from workspaces w
      join workspace_members m on m.workspace_id = w.id
      where m.user_id = ${uid} and m.role = 'owner'`;
    expect(ws.length).toBe(1);
    expect(ws[0].name).toContain(email.split("@")[0]);
  });
});
