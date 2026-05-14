import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { createBoardImpl } from "@/actions/boards";
import { createCardImpl } from "@/actions/cards";
import {
  createListImpl,
  moveCardToListImpl,
} from "@/actions/lists";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { positionBetween } from "@/lib/ordering";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
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

describe("backlog move-to-list action", () => {
  it("moves a backlog card into a valid board list without RLS denial", async () => {
    const user = await makeUser("backlog-move");
    const workspace = await createWorkspaceImpl(user.jwt, { name: "WS" });
    const board = await createBoardImpl(user.jwt, {
      workspaceId: workspace.id,
      title: "B",
      backgroundKind: "color",
      backgroundValue: "#000",
    });
    const backlog = await createListImpl(user.jwt, {
      boardId: board.id,
      title: "Backlog",
    });
    const target = await createListImpl(user.jwt, {
      boardId: board.id,
      title: "In Progress",
    });
    const card = await createCardImpl(user.jwt, {
      listId: backlog.id,
      title: "Backlog task",
    });
    expect(card.sprintId).toBeNull();

    const position = positionBetween(null, null);
    const result = await moveCardToListImpl(user.jwt, {
      cardId: card.id,
      toListId: target.id,
      position,
    });

    expect(result.success).toBe(true);
    expect(result.card.listId).toBe(target.id);

    const [row] = await dbAsUser(user.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, card.id)),
    );
    expect(row.listId).toBe(target.id);
    expect(row.boardId).toBe(board.id);
    expect(row.position).toBe(position);
  });
});
