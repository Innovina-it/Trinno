import { NextResponse, type NextRequest } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listCardHistory } from "@/lib/queries/card-history";

// Lazy endpoint for the history accordion in the card modal. Keeps the
// initial card-modal payload small for cards with hundreds of audit
// rows. RLS on card_field_history + card_sprint_history enforces
// "must be able to see the card" — no extra app-level check needed.

export async function GET(req: NextRequest) {
  await requireUser();
  const token = (await getSessionToken())!;
  const cardId = req.nextUrl.searchParams.get("cardId");
  if (!cardId) {
    return NextResponse.json({ error: "cardId required" }, { status: 400 });
  }
  const rows = await listCardHistory(token, cardId);
  return NextResponse.json({ rows });
}
