import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl, updateCardImpl, moveCardImpl, archiveCardImpl,
} from "@/actions/cards";

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

async function setupBoardWithLists(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  const l2 = await createListImpl(jwt, { boardId: b.id, title: "L2" });
  return { b, l1, l2 };
}

describe("card actions (impl)", () => {
  it("creates, updates, moves across lists, archives", async () => {
    const u = await makeUser("cd");
    const { b, l1, l2 } = await setupBoardWithLists(u.jwt);

    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "Card A" });
    expect(c.boardId).toBe(b.id);
    expect(c.listId).toBe(l1.id);

    const upd = await updateCardImpl(u.jwt, { id: c.id, title: "Card A!", description: "Desc" });
    expect(upd.title).toBe("Card A!");
    expect(upd.description).toBe("Desc");

    const { generateKeyBetween } = await import("fractional-indexing");
    const newPos = generateKeyBetween(null, null);
    const moved = await moveCardImpl(u.jwt, { id: c.id, listId: l2.id, position: newPos });
    expect(moved.listId).toBe(l2.id);
    expect(moved.boardId).toBe(b.id);

    await archiveCardImpl(u.jwt, { id: c.id, archived: true });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id))
    );
    expect(row.archived).toBe(true);
  });

  it("non-member cannot create a card", async () => {
    const owner = await makeUser("cd-o");
    const other = await makeUser("cd-x");
    const { l1 } = await setupBoardWithLists(owner.jwt);
    await expect(createCardImpl(other.jwt, { listId: l1.id, title: "X" }))
      .rejects.toThrow();
  });
});
