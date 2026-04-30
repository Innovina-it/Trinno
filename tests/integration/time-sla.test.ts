import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards, cardSla } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { logWorkImpl, deleteWorklogImpl } from "@/actions/worklogs";
import { createSlaPolicyImpl, scanBoardSlaImpl } from "@/actions/sla";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { b, l };
}

describe("time tracking + sla", () => {
  it("logging work updates cards.spent_min via trigger", async () => {
    const u = await makeUser("tw1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await logWorkImpl(u.jwt, { cardId: c.id, minutes: 30, comment: "design" });
    await logWorkImpl(u.jwt, { cardId: c.id, minutes: 90 });

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect((row as { spentMin: number }).spentMin).toBe(120);
  });

  it("deleting a worklog reduces spent_min", async () => {
    const u = await makeUser("tw2");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    const w = await logWorkImpl(u.jwt, { cardId: c.id, minutes: 60 });
    await deleteWorklogImpl(u.jwt, { id: w.id });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect((row as { spentMin: number }).spentMin).toBe(0);
  });

  it("estimate_min update validates non-negative", async () => {
    const u = await makeUser("tw3");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    const ok = await updateCardImpl(u.jwt, { id: c.id, estimateMin: 240 });
    expect((ok as { estimateMin?: number | null }).estimateMin).toBe(240);
    await expect(
      updateCardImpl(u.jwt, { id: c.id, estimateMin: -1 }),
    ).rejects.toThrow();
  });

  it("scan creates a card_sla breach when threshold passed", async () => {
    const u = await makeUser("tw4");
    const { b, l } = await setup(u.jwt);
    // Create policy with target = 1 minute.
    const sla = await createSlaPolicyImpl(u.jwt, {
      boardId: b.id,
      name: "Quick triage",
      targetMin: 1,
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    // Backdate created_at to 2 minutes ago via service role.
    await service
      .from("cards")
      .update({ created_at: new Date(Date.now() - 2 * 60_000).toISOString() })
      .eq("id", c.id);

    const r = await scanBoardSlaImpl(u.jwt, { boardId: b.id });
    expect(r.breachedActive).toBe(1);

    const breaches = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardSla).where(eq(cardSla.cardId, c.id)),
    );
    expect(breaches.length).toBe(1);
    expect(breaches[0].slaId).toBe(sla.id);
  });

  it("non-admin cannot create SLA policy", async () => {
    const owner = await makeUser("tw5o");
    const other = await makeUser("tw5x");
    const { b } = await setup(owner.jwt);
    await expect(
      createSlaPolicyImpl(other.jwt, {
        boardId: b.id,
        name: "Stranger SLA",
        targetMin: 60,
      }),
    ).rejects.toThrow();
  });
});
