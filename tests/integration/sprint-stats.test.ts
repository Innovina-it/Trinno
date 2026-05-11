import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  updateCardImpl,
} from "@/actions/cards";
import {
  createSprintImpl,
  startSprintImpl,
  completeSprintImpl,
  assignCardToSprintImpl,
} from "@/actions/sprints";
import { computeBurndown, computeVelocity } from "@/lib/queries/sprints-stats";

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

describe("sprint stats", () => {
  it("rejects negative or out-of-range story points", async () => {
    const u = await makeUser("st1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await expect(
      updateCardImpl(u.jwt, { id: c.id, storyPoints: -1 }),
    ).rejects.toThrow();
    await expect(
      updateCardImpl(u.jwt, { id: c.id, storyPoints: 10000 }),
    ).rejects.toThrow();
    const ok = await updateCardImpl(u.jwt, { id: c.id, storyPoints: 5 });
    expect((ok as { storyPoints?: number | null }).storyPoints).toBe(5);
  });

  it("burndown sums committed and remaining correctly", async () => {
    const u = await makeUser("st2");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S",
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000 * 5),
    });
    const c1 = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    const c2 = await createCardImpl(u.jwt, { listId: l.id, title: "B" });
    await updateCardImpl(u.jwt, { id: c1.id, storyPoints: 3 });
    await updateCardImpl(u.jwt, { id: c2.id, storyPoints: 5 });
    await assignCardToSprintImpl(u.jwt, { cardId: c1.id, sprintId: sp.id });
    await assignCardToSprintImpl(u.jwt, { cardId: c2.id, sprintId: sp.id });

    const r = await computeBurndown(u.jwt, sp.id);
    expect(r.total).toBe(8);
    expect(r.points.length).toBeGreaterThan(0);
    expect(r.points[0].pointsRemaining).toBe(8);
    expect(r.points[0].pointsCompleted).toBe(0);
  });

  it("burndown reflects a completed card's points as completed", async () => {
    // After migration 0062, completion is `cards.completed_at` (not
    // `archived`). The DB trigger keeps `due_complete` mirrored.
    const u = await makeUser("st3");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S",
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, storyPoints: 8 });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    await updateCardImpl(u.jwt, { id: c.id, completed: true });

    const r = await computeBurndown(u.jwt, sp.id);
    const lastPoint = r.points[r.points.length - 1];
    expect(lastPoint.pointsCompleted).toBe(8);
    expect(lastPoint.pointsRemaining).toBe(0);
  });

  it("velocity returns completed sprints with summed points", async () => {
    // Velocity now reads `cards.completed_at` (migration 0062). Mark the
    // card complete BEFORE starting the sprint so completed_at lands
    // inside the sprint's open window per `card_sprint_history`.
    const u = await makeUser("st4");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, storyPoints: 13 });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    await startSprintImpl(u.jwt, { id: sp.id });
    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    await completeSprintImpl(u.jwt, { id: sp.id, carryoverTo: "backlog" });

    const v = await computeVelocity(u.jwt, ws.id, 6);
    expect(v.length).toBe(1);
    expect(v[0].pointsCompleted).toBe(13);
  });
});
