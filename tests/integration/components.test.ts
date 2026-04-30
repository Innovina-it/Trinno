import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardComponents, components, boardMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  createComponentImpl,
  updateComponentImpl,
  deleteComponentImpl,
} from "@/actions/components";
import { toggleCardComponentImpl } from "@/actions/card-components";

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

describe("components + card_components", () => {
  it("create + toggle on card sets denorm board_id", async () => {
    const u = await makeUser("co1");
    const { b, l } = await setup(u.jwt);
    const comp = await createComponentImpl(u.jwt, {
      boardId: b.id,
      name: "auth",
    });
    expect(comp.boardId).toBe(b.id);
    expect(comp.name).toBe("auth");

    const card = await createCardImpl(u.jwt, { listId: l.id, title: "Card" });
    const r = await toggleCardComponentImpl(u.jwt, {
      cardId: card.id,
      componentId: comp.id,
    });
    expect(r.attached).toBe(true);

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(cardComponents)
        .where(
          and(
            eq(cardComponents.cardId, card.id),
            eq(cardComponents.componentId, comp.id),
          ),
        ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].boardId).toBe(b.id);
  });

  it("toggle off on second call removes the row", async () => {
    const u = await makeUser("co2");
    const { b, l } = await setup(u.jwt);
    const comp = await createComponentImpl(u.jwt, {
      boardId: b.id,
      name: "billing",
    });
    const card = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await toggleCardComponentImpl(u.jwt, {
      cardId: card.id,
      componentId: comp.id,
    });
    const second = await toggleCardComponentImpl(u.jwt, {
      cardId: card.id,
      componentId: comp.id,
    });
    expect(second.attached).toBe(false);
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(cardComponents)
        .where(
          and(
            eq(cardComponents.cardId, card.id),
            eq(cardComponents.componentId, comp.id),
          ),
        ),
    );
    expect(rows.length).toBe(0);
  });

  it("update / delete cascades the junction", async () => {
    const u = await makeUser("co3");
    const { b, l } = await setup(u.jwt);
    const comp = await createComponentImpl(u.jwt, {
      boardId: b.id,
      name: "auth",
    });
    const renamed = await updateComponentImpl(u.jwt, {
      id: comp.id,
      name: "authn",
    });
    expect(renamed.name).toBe("authn");

    const card = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await toggleCardComponentImpl(u.jwt, {
      cardId: card.id,
      componentId: comp.id,
    });
    await deleteComponentImpl(u.jwt, { id: comp.id });

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(cardComponents)
        .where(eq(cardComponents.componentId, comp.id)),
    );
    expect(rows.length).toBe(0);
  });

  it("non-admin board member cannot create component", async () => {
    const owner = await makeUser("co4o");
    const guest = await makeUser("co4g");
    const { b } = await setup(owner.jwt);

    // Add guest as a board MEMBER (not admin) directly via service role.
    await service.from("board_members").insert({
      board_id: b.id,
      user_id: guest.id,
      role: "member",
    });

    // Sanity: guest can read the board's components list.
    const empty = await dbAsUser(guest.jwt, async (tx) =>
      tx.select().from(boardMembers).where(eq(boardMembers.boardId, b.id)),
    );
    expect(empty.length).toBeGreaterThanOrEqual(1);

    await expect(
      createComponentImpl(guest.jwt, { boardId: b.id, name: "nope" }),
    ).rejects.toThrow();
  });

  it("user from board B cannot attach component A to a card on board B", async () => {
    const ownerA = await makeUser("co5a");
    const ownerB = await makeUser("co5b");
    const { b: boardA } = await setup(ownerA.jwt);
    const { l: listB } = await setup(ownerB.jwt);

    const compA = await createComponentImpl(ownerA.jwt, {
      boardId: boardA.id,
      name: "shared",
    });
    const cardB = await createCardImpl(ownerB.jwt, {
      listId: listB.id,
      title: "Foreign",
    });

    // ownerB tries to attach componentA (different workspace entirely) to cardB.
    await expect(
      toggleCardComponentImpl(ownerB.jwt, {
        cardId: cardB.id,
        componentId: compA.id,
      }),
    ).rejects.toThrow();

    // Confirm the row was not created.
    const rows = await dbAsUser(ownerB.jwt, async (tx) =>
      tx
        .select()
        .from(cardComponents)
        .where(eq(cardComponents.cardId, cardB.id)),
    );
    expect(rows.length).toBe(0);
    // And ownerA's component is intact.
    const stillThere = await dbAsUser(ownerA.jwt, async (tx) =>
      tx.select().from(components).where(eq(components.id, compA.id)),
    );
    expect(stillThere.length).toBe(1);
  });
});
