import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";

export async function GET() {
  await requireUser();
  const token = (await getSessionToken())!;
  const [items, unread] = await Promise.all([
    listNotifications(token, { limit: 8 }),
    unreadCount(token),
  ]);
  return NextResponse.json({ items, unread });
}
