import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { activity } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, renameListImpl } from "@/actions/lists";
import { createCardImpl, archiveCardImpl, moveCardImpl } from "@/actions/cards";
import { createCommentImpl } from "@/actions/comments";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("activity triggers", () => {
  it("emits rows for list/card/comment lifecycle", async () => {
    const u = await makeUser("act");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const l1 = await createListImpl(u.jwt, { boardId: b.id, title: "L1" });
    const l2 = await createListImpl(u.jwt, { boardId: b.id, title: "L2" });
    await renameListImpl(u.jwt, { id: l1.id, title: "L1!" });
    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "C" });
    const { generateKeyBetween } = await import("fractional-indexing");
    await moveCardImpl(u.jwt, { id: c.id, listId: l2.id, position: generateKeyBetween(null, null) });
    await archiveCardImpl(u.jwt, { id: c.id, archived: true });
    await createCommentImpl(u.jwt, { cardId: c.id, body: "hi" });

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select({ type: activity.type })
        .from(activity).where(eq(activity.boardId, b.id))
    );
    const types = new Set(rows.map(r => r.type));
    expect(types.has("list.create")).toBe(true);
    expect(types.has("list.rename")).toBe(true);
    expect(types.has("card.create")).toBe(true);
    expect(types.has("card.move")).toBe(true);
    expect(types.has("card.archive")).toBe(true);
    expect(types.has("comment.create")).toBe(true);
  });
});
