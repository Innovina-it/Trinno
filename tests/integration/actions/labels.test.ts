import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { labels, cardLabels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { createLabelImpl, renameLabelImpl, deleteLabelImpl, toggleCardLabelImpl } from "@/actions/labels";

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

describe("label actions (impl)", () => {
  it("create, rename, toggle on card, toggle off, delete", async () => {
    const u = await makeUser("lbl");
    const { b, c } = await setup(u.jwt);

    const lab = await createLabelImpl(u.jwt, { boardId: b.id, name: "P0", color: "#f00" });
    expect(lab.color).toBe("#f00");

    const renamed = await renameLabelImpl(u.jwt, { id: lab.id, name: "P1", color: "#0f0" });
    expect(renamed.name).toBe("P1");

    const r1 = await toggleCardLabelImpl(u.jwt, { cardId: c.id, labelId: lab.id });
    expect(r1.attached).toBe(true);
    const found1 = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLabels).where(and(
        eq(cardLabels.cardId, c.id), eq(cardLabels.labelId, lab.id),
      ))
    );
    expect(found1[0].boardId).toBe(b.id);

    const r2 = await toggleCardLabelImpl(u.jwt, { cardId: c.id, labelId: lab.id });
    expect(r2.attached).toBe(false);

    await deleteLabelImpl(u.jwt, { id: lab.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(labels).where(eq(labels.id, lab.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-member cannot create a label", async () => {
    const owner = await makeUser("lbl-o");
    const other = await makeUser("lbl-x");
    const { b } = await setup(owner.jwt);
    await expect(createLabelImpl(other.jwt, { boardId: b.id, name: "X", color: "#f00" }))
      .rejects.toThrow();
  });
});
