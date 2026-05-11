import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import {
  createSprintImpl,
  startSprintImpl,
  completeSprintImpl,
  assignCardToSprintImpl,
} from "@/actions/sprints";
import { computeVelocity } from "@/lib/queries/sprints-stats";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
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
    backgroundValue: "#000",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

function findVelocity(
  rows: Array<{ sprintId: string; pointsCompleted: number }>,
  sprintId: string,
): number {
  return rows.find((r) => r.sprintId === sprintId)?.pointsCompleted ?? 0;
}

describe("computeVelocity (history-attributed)", () => {
  it("attributes points to the sprint the card was IN at completion time", async () => {
    const u = await makeUser("vh1");
    const { ws, l } = await setup(u.jwt);

    // Sprint S1 (planned → active).
    const s1 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
    });
    await startSprintImpl(u.jwt, { id: s1.id });

    // Card C with 5 SP, assigned to S1 — opens history #1 on S1.
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, storyPoints: 5 });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: s1.id });

    // Sprint S2 created planned. completeSprintImpl(S1, carryoverTo=S2)
    // moves C (still uncompleted) onto S2 in a single shot — closes
    // history #1 (S1) and opens history #2 (S2).
    const s2 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S2",
    });
    await completeSprintImpl(u.jwt, { id: s1.id, carryoverTo: s2.id });

    // Activate S2 and complete the card while it lives on S2 — its
    // completed_at must fall inside history #2's [assigned_at, now)
    // window AND inside S2's [start_date, completed_at] window.
    await startSprintImpl(u.jwt, { id: s2.id });
    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    await completeSprintImpl(u.jwt, { id: s2.id, carryoverTo: "backlog" });

    const velocity = await computeVelocity(u.jwt, ws.id, 6);
    // Both sprints completed → both appear.
    expect(velocity.length).toBe(2);
    // C was completed while on S2; the old approximation would have
    // attributed to S2 here as well (since cards.sprint_id was S2 at
    // completion). The history-based attribution must still credit S2.
    expect(findVelocity(velocity, s2.id)).toBe(5);
    // S1 must NOT be credited — completion happened after C left S1.
    expect(findVelocity(velocity, s1.id)).toBe(0);
  });

  it("re-assigning a completed card back to an earlier sprint does NOT reattribute velocity", async () => {
    const u = await makeUser("vh2");
    const { ws, l } = await setup(u.jwt);

    const s1 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
    });
    await startSprintImpl(u.jwt, { id: s1.id });

    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, storyPoints: 5 });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: s1.id });

    const s2 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S2",
    });
    await completeSprintImpl(u.jwt, { id: s1.id, carryoverTo: s2.id });
    await startSprintImpl(u.jwt, { id: s2.id });
    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    await completeSprintImpl(u.jwt, { id: s2.id, carryoverTo: "backlog" });

    // After both sprints close and C is completed, an admin moves the
    // (now completed) card back onto S1. Under the old approximation
    // velocity for S1 would suddenly jump from 0 to 5; with history
    // attribution, S2 still wins because C's completed_at falls inside
    // history #2 (S2), not the new history row that was just opened
    // on S1.
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: s1.id });

    const velocity = await computeVelocity(u.jwt, ws.id, 6);
    expect(velocity.length).toBe(2);
    expect(findVelocity(velocity, s2.id)).toBe(5);
    expect(findVelocity(velocity, s1.id)).toBe(0);
  });

  it("card moved to S2 BEFORE completion → S2 wins (not the original sprint)", async () => {
    // Mirrors the headline scenario in spec but spelled out as its own
    // case so a regression to the legacy `cards.sprint_id` reading is
    // caught even if the first test's fixtures shift.
    const u = await makeUser("vh3");
    const { ws, l } = await setup(u.jwt);

    const s1 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
    });
    await startSprintImpl(u.jwt, { id: s1.id });

    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, storyPoints: 8 });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: s1.id });

    // Carry over to S2 BEFORE completion.
    const s2 = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S2",
    });
    await completeSprintImpl(u.jwt, { id: s1.id, carryoverTo: s2.id });
    await startSprintImpl(u.jwt, { id: s2.id });

    // Complete on S2.
    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    await completeSprintImpl(u.jwt, { id: s2.id, carryoverTo: "backlog" });

    const velocity = await computeVelocity(u.jwt, ws.id, 6);
    expect(findVelocity(velocity, s2.id)).toBe(8);
    expect(findVelocity(velocity, s1.id)).toBe(0);
  });
});
