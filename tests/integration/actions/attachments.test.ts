import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  registerAttachmentImpl,
  deleteAttachmentImpl,
} from "@/actions/attachments";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  const c = await createCardImpl(jwt, { listId: l.id, title: "C" });
  return { b, c };
}

describe("attachment actions (impl)", () => {
  it("register an attachment, sets board_id and uploaded_by; storagePath round-trips", async () => {
    const u = await makeUser("att");
    const { b, c } = await setup(u.jwt);
    const path = `cards/${c.id}/abc-test.png`;
    const a = await registerAttachmentImpl(u.jwt, {
      cardId: c.id,
      storagePath: path,
      filename: "test.png",
      mime: "image/png",
      sizeBytes: 1234,
    });
    expect(a.boardId).toBe(b.id);
    expect(a.uploadedBy).toBe(u.id);
    expect(a.storagePath).toBe(path);
    expect(a.filename).toBe("test.png");
    expect(a.mime).toBe("image/png");
    expect(a.sizeBytes).toBe(1234);
  });

  it("delete an attachment removes the row", async () => {
    const u = await makeUser("att-d");
    const { c } = await setup(u.jwt);
    const a = await registerAttachmentImpl(u.jwt, {
      cardId: c.id,
      storagePath: `cards/${c.id}/x.txt`,
      filename: "x.txt",
      mime: "text/plain",
      sizeBytes: 1,
    });
    await deleteAttachmentImpl(u.jwt, { id: a.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(attachments).where(eq(attachments.id, a.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-member cannot register an attachment", async () => {
    const owner = await makeUser("att-o");
    const other = await makeUser("att-x");
    const { c } = await setup(owner.jwt);
    await expect(registerAttachmentImpl(other.jwt, {
      cardId: c.id,
      storagePath: `cards/${c.id}/y.txt`,
      filename: "y.txt",
      mime: "text/plain",
      sizeBytes: 1,
    })).rejects.toThrow();
  });
});
