import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { boardMembers, cards } from "@/lib/db/schema";

const Body = z.object({
  cardId: z.string().uuid(),
  filename: z.string().min(1).max(255),
});

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function POST(req: Request) {
  await requireUser();
  const token = (await getSessionToken())!;
  const body = Body.parse(await req.json());

  // Authorize: caller must be board member of the card's board.
  // Under RLS, board_members SELECT only returns rows visible to the caller,
  // so a non-member's query returns zero rows.
  const allowed = await dbAsUser(token, async (tx) => {
    const [c] = await tx.select({ boardId: cards.boardId }).from(cards)
      .where(eq(cards.id, body.cardId));
    if (!c) return false;
    const m = await tx.select().from(boardMembers).where(and(
      eq(boardMembers.boardId, c.boardId),
    ));
    return m.length > 0;
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const path = `cards/${body.cardId}/${crypto.randomUUID()}-${body.filename}`;
  const { data, error } = await admin.storage
    .from("card-attachments")
    .createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, path });
}
