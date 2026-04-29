import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { checklists, checklistItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  createChecklistImpl,
  renameChecklistImpl,
  deleteChecklistImpl,
  addChecklistItemImpl,
  toggleChecklistItemImpl,
  removeChecklistItemImpl,
} from "@/actions/checklists";

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

describe("checklist actions (impl)", () => {
  it("create checklist, add 2 items, toggle, remove, rename, delete cascades", async () => {
    const u = await makeUser("cl");
    const { b, c } = await setup(u.jwt);

    const cl = await createChecklistImpl(u.jwt, { cardId: c.id, title: "Tasks" });
    expect(cl.boardId).toBe(b.id);
    expect(cl.title).toBe("Tasks");

    const renamed = await renameChecklistImpl(u.jwt, { id: cl.id, title: "Done list" });
    expect(renamed.title).toBe("Done list");

    const i1 = await addChecklistItemImpl(u.jwt, { checklistId: cl.id, text: "first" });
    const i2 = await addChecklistItemImpl(u.jwt, { checklistId: cl.id, text: "second" });
    expect(i1.boardId).toBe(b.id);
    expect(i2.boardId).toBe(b.id);
    expect(i1.position < i2.position).toBe(true);

    const toggled = await toggleChecklistItemImpl(u.jwt, { id: i1.id, completed: true });
    expect(toggled.completed).toBe(true);

    await removeChecklistItemImpl(u.jwt, { id: i2.id });
    const remaining = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(checklistItems).where(eq(checklistItems.checklistId, cl.id))
    );
    expect(remaining.length).toBe(1);

    await deleteChecklistImpl(u.jwt, { id: cl.id });
    const afterChecklist = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(checklists).where(eq(checklists.id, cl.id))
    );
    expect(afterChecklist.length).toBe(0);
    const afterItems = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(checklistItems).where(eq(checklistItems.checklistId, cl.id))
    );
    expect(afterItems.length).toBe(0);
  });

  it("non-member cannot create a checklist", async () => {
    const owner = await makeUser("cl-o");
    const other = await makeUser("cl-x");
    const { c } = await setup(owner.jwt);
    await expect(createChecklistImpl(other.jwt, { cardId: c.id, title: "X" }))
      .rejects.toThrow();
  });

  it("non-member cannot add a checklist item", async () => {
    const owner = await makeUser("cli-o");
    const other = await makeUser("cli-x");
    const { c } = await setup(owner.jwt);
    const cl = await createChecklistImpl(owner.jwt, { cardId: c.id, title: "T" });
    await expect(addChecklistItemImpl(other.jwt, { checklistId: cl.id, text: "x" }))
      .rejects.toThrow();
  });
});
