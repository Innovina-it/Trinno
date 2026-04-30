import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { createCardLinkImpl } from "@/actions/card-links";
import { listRoadmapCards, listRoadmapLinks } from "@/lib/queries/roadmap";

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
  return { id: data.user!.id, email, jwt: s.session!.access_token };
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
  return { ws, b, l };
}

describe("listRoadmapCards / listRoadmapLinks", () => {
  it("returns only cards with both start_date and target_date in the workspace", async () => {
    const u = await makeUser("rm1");
    const { ws, l } = await setup(u.jwt);

    const a = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    await updateCardImpl(u.jwt, {
      id: a.id,
      type: "story",
      startDate: new Date("2026-05-01T00:00:00Z").toISOString(),
      targetDate: new Date("2026-05-10T00:00:00Z").toISOString(),
    });
    // Card B: dates not set — should be filtered out.
    await createCardImpl(u.jwt, { listId: l.id, title: "B" });

    // Foreign workspace (different user) with dates — must not leak.
    const u2 = await makeUser("rm1f");
    const { l: lF } = await setup(u2.jwt);
    const cF = await createCardImpl(u2.jwt, { listId: lF.id, title: "Foreign" });
    await updateCardImpl(u2.jwt, {
      id: cF.id,
      startDate: new Date("2026-05-01T00:00:00Z").toISOString(),
      targetDate: new Date("2026-05-10T00:00:00Z").toISOString(),
    });

    const rows = await listRoadmapCards(u.jwt, ws.id);
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    expect(rows[0].startDate).toBeInstanceOf(Date);
    expect(rows[0].targetDate).toBeInstanceOf(Date);
    expect(rows[0].boardTitle).toBe("B");
  });

  it("listRoadmapLinks reflects mirror-trigger direction (blocks A->B yields is_blocked_by B->A)", async () => {
    const u = await makeUser("rm2");
    const { ws, l } = await setup(u.jwt);
    const a = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    const b = await createCardImpl(u.jwt, { listId: l.id, title: "B" });

    // User creates "blocks" link from A to B. Mirror trigger inserts the
    // inverse "is_blocked_by" row from B to A.
    await createCardLinkImpl(u.jwt, {
      fromCardId: a.id,
      toCardId: b.id,
      kind: "blocks",
    });

    const links = await listRoadmapLinks(u.jwt, ws.id);
    // Exactly one is_blocked_by row, going B -> A.
    expect(links).toEqual([{ fromId: b.id, toId: a.id }]);
  });

  it("RLS isolates roadmap cards across workspaces", async () => {
    const owner = await makeUser("rm3o");
    const stranger = await makeUser("rm3s");
    const { ws, l } = await setup(owner.jwt);
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "Sec" });
    await updateCardImpl(owner.jwt, {
      id: c.id,
      startDate: new Date("2026-05-01T00:00:00Z").toISOString(),
      targetDate: new Date("2026-05-10T00:00:00Z").toISOString(),
    });

    // Stranger queries the *owner's* workspace — should see nothing.
    const rowsAsStranger = await listRoadmapCards(stranger.jwt, ws.id);
    expect(rowsAsStranger).toEqual([]);
  });
});
