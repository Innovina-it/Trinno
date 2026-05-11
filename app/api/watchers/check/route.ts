import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import {
  isWatchingCard,
  listCardWatchers,
} from "@/lib/queries/notifications";

export async function GET(req: Request) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ watching: false, watchers: [] });
  const [watching, watchers] = await Promise.all([
    isWatchingCard(token, cardId, user.id),
    listCardWatchers(token, cardId),
  ]);
  return NextResponse.json({ watching, watchers });
}
