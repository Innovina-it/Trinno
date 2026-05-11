import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards, sprints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  updateCardImpl,
  archiveCardImpl,
} from "@/actions/cards";
import {
  createSprintImpl,
  startSprintImpl,
  completeSprintImpl,
  assignCardToSprintImpl,
} from "@/actions/sprints";

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

describe("completeSprintImpl carryover (completedAt-based)", () => {
  it("keeps completed cards on the closing sprint; archived-but-not-completed and open cards carry over", async () => {
    const u = await makeUser("scc");
    const { ws, l1 } = await setupBoardWithLists(u.jwt);

    const dayMs = 86_400_000;
    const sprint = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
      startDate: new Date(Date.now() - dayMs),
      endDate: new Date(Date.now() + dayMs),
    });
    // completeSprintImpl requires the sprint to be in the `active` state.
    await startSprintImpl(u.jwt, { id: sprint.id });

    // A: completed via updateCardImpl({ completed: true }) — should STAY on S1.
    const cA = await createCardImpl(u.jwt, { listId: l1.id, title: "A" });
    await assignCardToSprintImpl(u.jwt, { cardId: cA.id, sprintId: sprint.id });
    await updateCardImpl(u.jwt, { id: cA.id, completed: true });

    // B: archived but not completed — should carry over (sprintId → null).
    const cB = await createCardImpl(u.jwt, { listId: l1.id, title: "B" });
    await assignCardToSprintImpl(u.jwt, { cardId: cB.id, sprintId: sprint.id });
    await archiveCardImpl(u.jwt, { id: cB.id, archived: true });

    // C: open — should carry over.
    const cC = await createCardImpl(u.jwt, { listId: l1.id, title: "C" });
    await assignCardToSprintImpl(u.jwt, { cardId: cC.id, sprintId: sprint.id });

    // Close the sprint, sending unfinished cards to the backlog.
    await completeSprintImpl(u.jwt, { id: sprint.id, carryoverTo: "backlog" });

    // Sprint state + completedAt.
    const [sRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.id, sprint.id)),
    );
    expect(sRow.state).toBe("completed");
    expect(sRow.completedAt).not.toBeNull();

    // Card sprint-id rebinding.
    const [aRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, cA.id)),
    );
    const [bRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, cB.id)),
    );
    const [cRow] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, cC.id)),
    );

    expect(aRow.sprintId).toBe(sprint.id); // completed: stays on closing sprint
    expect(bRow.sprintId).toBeNull(); // archived but not completed: carries over
    expect(cRow.sprintId).toBeNull(); // open: carries over
  });
});
