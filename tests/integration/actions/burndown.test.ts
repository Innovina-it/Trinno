import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import {
  createSprintImpl,
  assignCardToSprintImpl,
} from "@/actions/sprints";
import { computeBurndown } from "@/lib/queries/sprints-stats";

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

async function setupBoardWithLists(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  return { ws, b, l1 };
}

describe("computeBurndown", () => {
  it("sums total story points and reflects completion / un-completion", async () => {
    const u = await makeUser("bd");
    const { ws, l1 } = await setupBoardWithLists(u.jwt);

    // Sprint window: yesterday → tomorrow so today's `pointsCompleted`
    // lands on the last day of the burndown series.
    const dayMs = 86_400_000;
    const yesterday = new Date(Date.now() - dayMs);
    const tomorrow = new Date(Date.now() + dayMs);
    const sprint = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
      startDate: yesterday,
      endDate: tomorrow,
    });

    // Two cards in the sprint: 5 SP + 3 SP = 8 SP total.
    const c1 = await createCardImpl(u.jwt, { listId: l1.id, title: "Five" });
    await updateCardImpl(u.jwt, { id: c1.id, storyPoints: 5 });
    await assignCardToSprintImpl(u.jwt, {
      cardId: c1.id,
      sprintId: sprint.id,
    });

    const c2 = await createCardImpl(u.jwt, { listId: l1.id, title: "Three" });
    await updateCardImpl(u.jwt, { id: c2.id, storyPoints: 3 });
    await assignCardToSprintImpl(u.jwt, {
      cardId: c2.id,
      sprintId: sprint.id,
    });

    // A third card with no story points must NOT contribute to the total.
    const c3 = await createCardImpl(u.jwt, { listId: l1.id, title: "Free" });
    await assignCardToSprintImpl(u.jwt, {
      cardId: c3.id,
      sprintId: sprint.id,
    });

    // Baseline: nothing complete yet.
    const before = await computeBurndown(u.jwt, sprint.id);
    expect(before.total).toBe(8);
    expect(before.points.length).toBeGreaterThan(0);
    expect(before.points[before.points.length - 1].pointsCompleted).toBe(0);

    // Mark the 5 SP card complete; the burndown should pick that up on
    // the last day of the series (≥ 5 because we may still be inside
    // the window when this assertion runs).
    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    const mid = await computeBurndown(u.jwt, sprint.id);
    expect(mid.total).toBe(8);
    expect(
      mid.points[mid.points.length - 1].pointsCompleted,
    ).toBeGreaterThanOrEqual(5);
    // Remaining mirrors completed across the same day.
    const last = mid.points[mid.points.length - 1];
    expect(last.pointsRemaining).toBe(8 - last.pointsCompleted);

    // Un-marking complete drops pointsCompleted back to zero across the
    // entire series — the trigger that mirrors `completed_at` from
    // `completed=false` clears it everywhere.
    await updateCardImpl(u.jwt, { id: c1.id, completed: false });
    const after = await computeBurndown(u.jwt, sprint.id);
    expect(after.total).toBe(8);
    for (const p of after.points) {
      expect(p.pointsCompleted).toBe(0);
    }
  });
});
