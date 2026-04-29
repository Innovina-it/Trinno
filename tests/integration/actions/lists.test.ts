import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import {
  createListImpl, renameListImpl, moveListImpl, archiveListImpl,
} from "@/actions/lists";

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

async function setupBoard(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  return createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
}

describe("list actions (impl)", () => {
  it("creates list, renames, moves, archives", async () => {
    const u = await makeUser("ls");
    const b = await setupBoard(u.jwt);

    const a = await createListImpl(u.jwt, { boardId: b.id, title: "To do" });
    const c = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    expect(a.position < c.position).toBe(true);

    const renamed = await renameListImpl(u.jwt, { id: a.id, title: "TODO" });
    expect(renamed.title).toBe("TODO");

    const { generateKeyBetween } = await import("fractional-indexing");
    const newPos = generateKeyBetween(c.position, null);
    await moveListImpl(u.jwt, { id: a.id, position: newPos });

    const ordered = await dbAsUser(u.jwt, async (tx) =>
      tx.select({ id: lists.id, position: lists.position })
        .from(lists).where(eq(lists.boardId, b.id)).orderBy(asc(lists.position))
    );
    expect(ordered[0].id).toBe(c.id);
    expect(ordered[1].id).toBe(a.id);

    await archiveListImpl(u.jwt, { id: a.id, archived: true });
    const stillThere = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(eq(lists.id, a.id))
    );
    expect(stillThere[0].archived).toBe(true);
  });

  it("non-member cannot create a list", async () => {
    const owner = await makeUser("ls-o");
    const other = await makeUser("ls-x");
    const b = await setupBoard(owner.jwt);
    await expect(createListImpl(other.jwt, { boardId: b.id, title: "Sneak" }))
      .rejects.toThrow();
  });
});
