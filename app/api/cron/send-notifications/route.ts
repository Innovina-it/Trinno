import { NextResponse } from "next/server";
import { dispatchTelegramNotifications } from "@/lib/notifications/dispatch";

// Vercel cron handler — TELEGRAM per-event delivery.  Schedule via
// `vercel.json`:
// { "crons": [{ "path": "/api/cron/send-notifications", "schedule": "0 8 * * *" }] }
//
// Auth: requires `Authorization: Bearer ${CRON_SECRET}` to match the
// CRON_SECRET env var (same pattern as /api/cron/send-emails).  Vercel's
// cron service sends this header automatically when configured; for manual
// triggers (e.g. local curl), pass the same header.
//
// This route is TELEGRAM-ONLY and never touches email — email keeps its own
// /api/cron/send-emails cron so there is no double-send.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchTelegramNotifications({ limit: 200 });
  return NextResponse.json(result);
}
