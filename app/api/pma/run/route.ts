import { NextResponse } from "next/server";

import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors/structured-error";
import { runAnalysis } from "@/lib/pma/run";

// PMA U9 — "Run analysis" route (DESIGN §3, §6). Owner/admin only. Thin: auth +
// role gate + parse → delegate to runAnalysis (the A→G pipeline). A run can take
// tens of seconds (Gemini Pro synthesis), so allow the platform max duration.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function statusFor(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCESS_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "FAILED_PRECONDITION":
      return 409;
    case "BAD_REQUEST":
    case "VALIDATION":
      return 400;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  const user = await requireUser();
  const token = (await getSessionToken())!;

  let workspaceId: string | undefined;
  try {
    const body = (await req.json()) as { workspaceId?: unknown };
    if (typeof body?.workspaceId === "string") workspaceId = body.workspaceId;
  } catch {
    // malformed/absent body → handled by the guard below
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "workspaceId is required." } },
      { status: 400 },
    );
  }

  try {
    // Owner/admin gate (RLS-checked role lookup).
    await dbAsUser(token, async (tx) => {
      assertWorkspaceWriter(await getWorkspaceRole(tx, workspaceId!, user.id));
    });

    const now = new Date();
    const runLabel =
      now
        .toLocaleString("en-GB", { timeZone: "Europe/Rome", hour12: false })
        .replace(",", "") + " (UTC+1)";

    const result = await runAnalysis({
      token,
      workspaceId,
      actorId: user.id,
      now: now.toISOString(),
      runLabel,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const e = StructuredError.fromUnknown(err);
    return NextResponse.json({ error: e.toJSON() }, { status: statusFor(e.code) });
  }
}
