import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
afterAll(async () => {
  await sql.end();
});

async function gate(email: string): Promise<Record<string, unknown>> {
  const event = sql.json({ user: { email } });
  const [row] = await sql`
    select public.auth_block_external_domains(${event}) as result
  `;
  return row.result as Record<string, unknown>;
}

describe("auth_block_external_domains carve-out", () => {
  it("blocks an external domain with no pending invite", async () => {
    const r = await gate(`stranger-${Date.now()}@gmail.com`);
    expect(r.error).toBeTruthy();
  });

  it("allows an internal domain", async () => {
    const r = await gate(`someone-${Date.now()}@innovina.it`);
    expect(r).toEqual({});
  });

  it("allows an external domain that has a pending invitation", async () => {
    const email = `invited-${Date.now()}@gmail.com`;
    // workspaces.owner_id + workspace_invitations.invited_by both FK profiles(id),
    // so seed the owner from profiles (which has a row per auth user via 0110).
    const [{ id: ownerId }] = await sql`
      select id from public.profiles limit 1
    `;
    const [{ id: wsId }] = await sql`
      insert into public.workspaces (name, owner_id)
      values ('carveout-ws', ${ownerId}) returning id
    `;
    await sql`
      insert into public.workspace_invitations
        (workspace_id, email, role, invited_by, status)
      values (${wsId}, ${email}, 'member', ${ownerId}, 'pending')
    `;

    const r = await gate(email);
    expect(r).toEqual({});

    await sql`
      update public.workspace_invitations
         set status = 'revoked' where email = ${email}
    `;
    const r2 = await gate(email);
    expect(r2.error).toBeTruthy();
  });
});
