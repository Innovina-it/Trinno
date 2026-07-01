import { NextResponse } from "next/server";

import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors/structured-error";
import { requestCancel } from "@/lib/pma/registry";

// PMA 0145 — cancel an in-flight run. Owner/admin only. Sets cancel_requested on
// the still-running row; the background pipeline polls it between stages/files
// and finishes the row 'cancelled'. Idempotent: cancelling a run that already
// finished is a no-op (the WHERE status='running' guard matches nothing).
export const dynamic = "force-dynamic";

function statusFor(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "ACCESS_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "BAD_REQUEST":
      return 400;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  const user = await requireUser();
  const token = (await getSessionToken())!;

  let workspaceId: string | undefined;
  let runId: string | undefined;
  try {
    const body = (await req.json()) as { workspaceId?: unknown; runId?: unknown };
    if (typeof body?.workspaceId === "string") workspaceId = body.workspaceId;
    if (typeof body?.runId === "string") runId = body.runId;
  } catch {
    // handled by the guard below
  }
  if (!workspaceId || !runId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "workspaceId and runId are required." } },
      { status: 400 },
    );
  }

  try {
    await dbAsUser(token, async (tx) => {
      assertWorkspaceWriter(await getWorkspaceRole(tx, workspaceId!, user.id));
    });
    await requestCancel(workspaceId, runId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = StructuredError.fromUnknown(err);
    return NextResponse.json({ error: e.toJSON() }, { status: statusFor(e.code) });
  }
}
