import { NextResponse, type NextRequest } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listCardHistory } from "@/lib/queries/card-history";

// Lazy endpoint for the history accordion in the card modal. Keeps the
// initial card-modal payload small for cards with hundreds of audit
// rows. RLS on card_field_history + card_sprint_history enforces
// "must be able to see the card" — no extra app-level check needed.
//
// Honors `limit`/`offset` so the modal pulls one page at a time instead
// of the whole feed; without them it returns the full (ceiling-bounded)
// set for backward compatibility. `total` lets callers show "X of Y".

export async function GET(req: NextRequest) {
  await requireUser();
  const token = (await getSessionToken())!;
  const cardId = req.nextUrl.searchParams.get("cardId");
  if (!cardId) {
    return NextResponse.json({ error: "cardId required" }, { status: 400 });
  }
  const all = await listCardHistory(token, cardId);

  const limitRaw = Number.parseInt(
    req.nextUrl.searchParams.get("limit") ?? "",
    10,
  );
  const offsetRaw = Number.parseInt(
    req.nextUrl.searchParams.get("offset") ?? "",
    10,
  );
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const rows =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? all.slice(offset, offset + limitRaw)
      : all;

  return NextResponse.json({ rows, total: all.length });
}
