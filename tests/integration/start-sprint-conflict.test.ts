import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import {
  createSprintImpl,
  startSprintImpl,
  assignCardToSprintImpl,
  bulkShiftCardDatesImpl,
} from "@/actions/sprints";

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

describe("startSprint conflict detection + bulkShiftCardDates", () => {
  it("startSprintImpl returns conflictCards for cards whose target_date is past sprint end", async () => {
    const u = await makeUser("conf1");
    const { ws, l } = await setup(u.jwt);
    // Sprint window: now -> now+7d
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
      startDate: now,
      endDate: end,
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Late" });
    // Target = now+30d — well past sprint.endDate
    const tgt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    await updateCardImpl(u.jwt, {
      id: c.id,
      targetDate: tgt.toISOString(),
    });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });

    const r = await startSprintImpl(u.jwt, { id: sp.id });
    expect(r.sprint.state).toBe("active");
    expect(r.conflictCards.length).toBe(1);
    expect(r.conflictCards[0].id).toBe(c.id);
  });

  it("returns empty conflictCards when all sprint cards fit inside the window", async () => {
    const u = await makeUser("conf2");
    const { ws, l } = await setup(u.jwt);
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
      startDate: now,
      endDate: end,
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "OnTime" });
    // Target = now+3d — comfortably inside the window
    const tgt = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    await updateCardImpl(u.jwt, {
      id: c.id,
      targetDate: tgt.toISOString(),
    });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });

    const r = await startSprintImpl(u.jwt, { id: sp.id });
    expect(r.conflictCards.length).toBe(0);
  });

  it("bulkShiftCardDates pulls overshooting cards back into the sprint window", async () => {
    const u = await makeUser("conf3");
    const { ws, l } = await setup(u.jwt);
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
      startDate: now,
      endDate: end,
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Late" });
    // Start = now+25d, target = now+30d — both well past
    const start = new Date(now.getTime() + 25 * 24 * 3600 * 1000);
    const tgt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    await updateCardImpl(u.jwt, {
      id: c.id,
      startDate: start.toISOString(),
      targetDate: tgt.toISOString(),
    });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });

    const before = await startSprintImpl(u.jwt, { id: sp.id });
    expect(before.conflictCards.length).toBe(1);

    // Shift back by 23 days: target becomes now+7d (== sprint end). Below is
    // measured in minutes so the dialog can pass arbitrary precision.
    const deltaMinutes = -23 * 24 * 60;
    const r = await bulkShiftCardDatesImpl(u.jwt, {
      cardIds: [c.id],
      deltaMinutes,
    });
    expect(r.updated).toBe(1);

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    // After the shift the card should land inside or at the sprint window.
    expect(row.targetDate).not.toBeNull();
    expect(row.targetDate!.getTime()).toBeLessThanOrEqual(end.getTime() + 60_000);
    expect(row.startDate!.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});
