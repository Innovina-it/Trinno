import { NextResponse } from "next/server";
import { processPendingEmails } from "@/lib/notify-email";

// Vercel cron handler.  Schedule via `vercel.json`:
// { "crons": [{ "path": "/api/cron/send-emails", "schedule": "*/5 * * * *" }] }
//
// Auth: requires `Authorization: Bearer ${CRON_SECRET}` to match the
// CRON_SECRET env var.  Vercel's cron service sends this header
// automatically when configured; for manual triggers (e.g. local
// curl), pass the same header.

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
  // Wait at least 30 seconds before emailing — gives the in-app
  // bundle dedup a chance to fold rapid-fire bulk events into one
  // notification before we send the email.
  const result = await processPendingEmails({
    limit: 200,
    olderThanMinutes: 0,
  });
  return NextResponse.json(result);
}
