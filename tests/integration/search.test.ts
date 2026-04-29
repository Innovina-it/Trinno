import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { searchCards } from "@/lib/queries/search";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function createCard(jwt: string, title: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return createCardImpl(jwt, { listId: l.id, title });
}

describe("searchCards", () => {
  it("returns matches and RLS hides others", async () => {
    const a = await makeUser("sr-a");
    const b = await makeUser("sr-b");
    await createCard(a.jwt, "Find me please");
    await createCard(b.jwt, "Hidden secret");

    const r1 = await searchCards(a.jwt, "find");
    expect(r1.length).toBe(1);
    expect(r1[0].title).toBe("Find me please");

    const r2 = await searchCards(a.jwt, "secret");
    expect(r2.length).toBe(0);
  });
});
