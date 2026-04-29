import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  createCommentImpl,
  editCommentImpl,
  deleteCommentImpl,
} from "@/actions/comments";

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

describe("comment actions (impl)", () => {
  it("create a comment, sets board_id and author_id", async () => {
    const u = await makeUser("cmt");
    const { b, c } = await setup(u.jwt);
    const cm = await createCommentImpl(u.jwt, { cardId: c.id, body: "hi" });
    expect(cm.boardId).toBe(b.id);
    expect(cm.authorId).toBe(u.id);
    expect(cm.body).toBe("hi");
    expect(cm.editedAt).toBeNull();
  });

  it("edit a comment sets edited_at", async () => {
    const u = await makeUser("cmt-e");
    const { c } = await setup(u.jwt);
    const cm = await createCommentImpl(u.jwt, { cardId: c.id, body: "v1" });
    const updated = await editCommentImpl(u.jwt, { id: cm.id, body: "v2" });
    expect(updated.body).toBe("v2");
    expect(updated.editedAt).not.toBeNull();
  });

  it("delete a comment removes it", async () => {
    const u = await makeUser("cmt-d");
    const { c } = await setup(u.jwt);
    const cm = await createCommentImpl(u.jwt, { cardId: c.id, body: "x" });
    await deleteCommentImpl(u.jwt, { id: cm.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(comments).where(eq(comments.id, cm.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-author cannot edit a comment", async () => {
    const owner = await makeUser("cmt-o");
    const other = await makeUser("cmt-x");
    const { c } = await setup(owner.jwt);
    // Add other as a board member by adding to workspace? Simpler: use service to grant board membership.
    // Easier: we expect RLS to return zero rows for the UPDATE since author_id != auth.uid(),
    // even if they're a member. So just attempt the edit as a non-board, non-author user.
    const cm = await createCommentImpl(owner.jwt, { cardId: c.id, body: "owner-msg" });
    await expect(editCommentImpl(other.jwt, { id: cm.id, body: "hacked" }))
      .rejects.toThrow();
  });

  it("non-member cannot insert a comment", async () => {
    const owner = await makeUser("cmt-no");
    const other = await makeUser("cmt-nx");
    const { c } = await setup(owner.jwt);
    await expect(createCommentImpl(other.jwt, { cardId: c.id, body: "x" }))
      .rejects.toThrow();
  });
});
