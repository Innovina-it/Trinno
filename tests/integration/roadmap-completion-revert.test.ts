import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";
import { createCardImpl, setRoadmapCompletionImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email, password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function readCard(jwt: string, cardId: string) {
  const [row] = await dbAsUser(jwt, async (tx) =>
    tx
      .select({
        listId: cards.listId,
        completedAt: cards.completedAt,
        preDoneListId: cards.preDoneListId,
      })
      .from(cards)
      .where(eq(cards.id, cardId)),
  );
  return row;
}

describe("setRoadmapCompletionImpl revert", () => {
  it("Done re-files to the done list; Open reverts to the previous list", async () => {
    const u = await makeUser("revert");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lTodo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: lTodo.id, statusKind: "todo" });
    const lDone = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    await setListStatusKindImpl(u.jwt, { id: lDone.id, statusKind: "done" });

    const c = await createCardImpl(u.jwt, { listId: lTodo.id, title: "Deliverable" });

    // Mark Done → completed_at stamped, card moved to the done list,
    // pre_done_list_id records where it came from.
    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    const afterDone = await readCard(u.jwt, c.id);
    expect(afterDone.completedAt).not.toBeNull();
    expect(afterDone.listId).toBe(lDone.id);
    expect(afterDone.preDoneListId).toBe(lTodo.id);

    // Set Open → completion cleared AND card reverts to the previous list.
    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    const afterOpen = await readCard(u.jwt, c.id);
    expect(afterOpen.completedAt).toBeNull();
    expect(afterOpen.listId).toBe(lTodo.id); // reverted to the original list
    expect(afterOpen.preDoneListId).toBeNull();
  });
});
