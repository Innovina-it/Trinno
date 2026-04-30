import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  updateCardImpl,
  cascadeShiftBlockedAfterImpl,
} from "@/actions/cards";
import { createCardLinkImpl } from "@/actions/card-links";

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
  return { ws, b, l };
}

describe("cascadeShiftBlockedAfter", () => {
  it("shifts a transitively blocked card by the given delta", async () => {
    const u = await makeUser("cascade1");
    const { l } = await setup(u.jwt);

    // A blocks B (B is_blocked_by A). A: Jun 1 → Jun 5. B: Jun 5 → Jun 10.
    const A = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    const B = await createCardImpl(u.jwt, { listId: l.id, title: "B" });
    const startA = new Date("2026-06-01T00:00:00Z");
    const tgtA = new Date("2026-06-05T00:00:00Z");
    const startB = new Date("2026-06-05T00:00:00Z");
    const tgtB = new Date("2026-06-10T00:00:00Z");
    await updateCardImpl(u.jwt, {
      id: A.id,
      startDate: startA.toISOString(),
      targetDate: tgtA.toISOString(),
    });
    await updateCardImpl(u.jwt, {
      id: B.id,
      startDate: startB.toISOString(),
      targetDate: tgtB.toISOString(),
    });
    await createCardLinkImpl(u.jwt, {
      fromCardId: B.id,
      toCardId: A.id,
      kind: "is_blocked_by",
    });

    // Cascade shift dependents of A by +10 days. B should land Jun 15 → Jun 20.
    const r = await cascadeShiftBlockedAfterImpl(u.jwt, {
      cardId: A.id,
      deltaDays: 10,
    });
    expect(r.shifted.length).toBe(1);
    expect(r.shifted[0].id).toBe(B.id);
    expect(r.shifted[0].deltaDays).toBe(10);

    const [bRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, B.id)),
    );
    expect(bRow.startDate?.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(bRow.targetDate?.toISOString().slice(0, 10)).toBe("2026-06-20");

    // A itself stays put — the cascade only moves dependents.
    const [aRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, A.id)),
    );
    expect(aRow.startDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(aRow.targetDate?.toISOString().slice(0, 10)).toBe("2026-06-05");
  });

  it("returns empty shifted list when card has no dependents", async () => {
    const u = await makeUser("cascade2");
    const { l } = await setup(u.jwt);
    const A = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    await updateCardImpl(u.jwt, {
      id: A.id,
      startDate: "2026-06-01T00:00:00Z",
      targetDate: "2026-06-05T00:00:00Z",
    });
    const r = await cascadeShiftBlockedAfterImpl(u.jwt, {
      cardId: A.id,
      deltaDays: 5,
    });
    expect(r.shifted.length).toBe(0);
  });
});
