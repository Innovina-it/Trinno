import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorklogsForCard } from "@/lib/queries/worklogs";

export async function GET(req: Request) {
  await requireUser();
  const token = (await getSessionToken())!;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ items: [] });
  const items = await listWorklogsForCard(token, cardId);
  return NextResponse.json({ items });
}
