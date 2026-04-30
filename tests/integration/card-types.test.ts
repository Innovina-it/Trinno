import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

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

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { b, l };
}

describe("card types + hierarchy", () => {
  it("defaults to task and accepts type changes", async () => {
    const u = await makeUser("ct1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    expect((c as { type: string }).type).toBe("task");
    const updated = await updateCardImpl(u.jwt, { id: c.id, type: "epic" });
    expect((updated as { type: string }).type).toBe("epic");
  });

  it("rejects subtask without parent", async () => {
    const u = await makeUser("ct2");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await expect(
      updateCardImpl(u.jwt, { id: c.id, type: "subtask" }),
    ).rejects.toThrow();
  });

  it("rejects parent cycle", async () => {
    const u = await makeUser("ct3");
    const { l } = await setup(u.jwt);
    const a = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    const b = await createCardImpl(u.jwt, { listId: l.id, title: "B" });
    await updateCardImpl(u.jwt, { id: b.id, parentCardId: a.id });
    let err: unknown;
    try {
      await updateCardImpl(u.jwt, { id: a.id, parentCardId: b.id });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const e = err as { message: string; cause?: { message?: string } };
    const combined = `${e.message} ${e.cause?.message ?? ""}`;
    expect(combined).toMatch(/cycle/);
  });

  it("can attach a subtask to a story parent", async () => {
    const u = await makeUser("ct4");
    const { l } = await setup(u.jwt);
    const story = await createCardImpl(u.jwt, { listId: l.id, title: "S" });
    await updateCardImpl(u.jwt, { id: story.id, type: "story" });
    const sub = await createCardImpl(u.jwt, { listId: l.id, title: "child" });
    const updated = await updateCardImpl(u.jwt, {
      id: sub.id, type: "subtask", parentCardId: story.id,
    });
    expect((updated as { type: string }).type).toBe("subtask");
    expect((updated as { parentCardId: string }).parentCardId).toBe(story.id);

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.parentCardId, story.id))
    );
    expect(rows.length).toBe(1);
  });
});
