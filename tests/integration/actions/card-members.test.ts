import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { toggleCardMemberImpl } from "@/actions/card-members";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  const c = await createCardImpl(jwt, { listId: l.id, title: "C" });
  return { b, c };
}

describe("card-member actions (impl)", () => {
  it("toggle assignee on, off; sets board_id via trigger", async () => {
    const u = await makeUser("cm");
    const { b, c } = await setup(u.jwt);

    const r1 = await toggleCardMemberImpl(u.jwt, { cardId: c.id, userId: u.id });
    expect(r1.assigned).toBe(true);

    const found = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardMembers).where(and(
        eq(cardMembers.cardId, c.id), eq(cardMembers.userId, u.id),
      ))
    );
    expect(found[0].boardId).toBe(b.id);

    const r2 = await toggleCardMemberImpl(u.jwt, { cardId: c.id, userId: u.id });
    expect(r2.assigned).toBe(false);

    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardMembers).where(and(
        eq(cardMembers.cardId, c.id), eq(cardMembers.userId, u.id),
      ))
    );
    expect(after.length).toBe(0);
  });

  it("non-member cannot toggle a card member", async () => {
    const owner = await makeUser("cm-o");
    const other = await makeUser("cm-x");
    const { c } = await setup(owner.jwt);
    await expect(toggleCardMemberImpl(other.jwt, { cardId: c.id, userId: other.id }))
      .rejects.toThrow();
  });
});
