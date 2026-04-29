import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { boards, boardMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  createBoardImpl, renameBoardImpl, setBoardArchivedImpl, deleteBoardImpl,
} from "@/actions/boards";

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

describe("board actions (impl)", () => {
  it("createBoardImpl creates a board + adds creator as admin", async () => {
    const u = await makeUser("brd-c");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Sprint 1",
      backgroundKind: "color", backgroundValue: "#0079bf",
    });
    expect(b.title).toBe("Sprint 1");
    expect(b.workspaceId).toBe(ws.id);

    const bm = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boardMembers)
        .where(and(eq(boardMembers.boardId, b.id), eq(boardMembers.userId, u.id)))
    );
    expect(bm[0].role).toBe("admin");
  });

  it("renameBoardImpl + setBoardArchivedImpl + deleteBoardImpl work for board admin", async () => {
    const u = await makeUser("brd-e");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS2" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Old",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const renamed = await renameBoardImpl(u.jwt, { id: b.id, title: "New" });
    expect(renamed.title).toBe("New");

    await setBoardArchivedImpl(u.jwt, { id: b.id, archived: true });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.id, b.id))
    );
    expect(row.archived).toBe(true);

    await deleteBoardImpl(u.jwt, { id: b.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.id, b.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-member cannot create a board in another user's workspace", async () => {
    const owner = await makeUser("brd-o");
    const other = await makeUser("brd-x");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Private" });
    await expect(createBoardImpl(other.jwt, {
      workspaceId: ws.id, title: "Sneaky",
      backgroundKind: "color", backgroundValue: "#fff",
    })).rejects.toThrow();
  });
});
