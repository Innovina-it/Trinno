import { NextResponse, after } from "next/server";

import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { getWorkspace } from "@/lib/queries/workspaces";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors/structured-error";
import { startAnalysis, executeAnalysis } from "@/lib/pma/run";
import { listRuns, getActiveRun, reapStaleRuns } from "@/lib/pma/registry";
import { serializeRun, STALE_RUN_MS } from "@/lib/pma/run-status";
import { sanitizeReportSections } from "@/lib/pma/report-sections";
import {
  sanitizeReportLength,
  sanitizeCustomPrompt,
  type ReportLength,
} from "@/lib/pma/report-settings";

// PMA U9 — "Run analysis" route (DESIGN §3, §6). Owner/admin only. Thin: auth +
// role gate + parse → start the run and hand the A→G pipeline to a background
// task (0145 run manager), returning the run id immediately. GET polls status.
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
  let startDate: string | undefined;
  let endDate: string | undefined;
  // U3 — the report-section selection from the run panel. Sanitized to known
  // keys/booleans; absent → leave the saved combination + all sections on.
  let sections: ReturnType<typeof sanitizeReportSections> | undefined;
  // 0143 — report length + custom focus from the run panel.
  let reportLength: ReportLength | undefined;
  let customPrompt: string | null | undefined;
  try {
    const body = (await req.json()) as {
      workspaceId?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      sections?: unknown;
      reportLength?: unknown;
      customPrompt?: unknown;
    };
    if (typeof body?.workspaceId === "string") workspaceId = body.workspaceId;
    if (typeof body?.startDate === "string") startDate = body.startDate;
    if (typeof body?.endDate === "string") endDate = body.endDate;
    if (body?.sections != null) sections = sanitizeReportSections(body.sections);
    if (body?.reportLength != null)
      reportLength = sanitizeReportLength(body.reportLength);
    if (body?.customPrompt !== undefined)
      customPrompt = sanitizeCustomPrompt(body.customPrompt);
  } catch {
    // malformed/absent body → handled by the guard below
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "workspaceId is required." } },
      { status: 400 },
    );
  }

  // U12.10 — the window is OPTIONAL. Only when BOTH dates are given do we scope
  // to a period; otherwise the whole document is analysed. Dates are clamped to
  // UTC day boundaries (the picker uses UTC).
  let window: { start: string; end: string } | undefined;
  if (startDate && endDate) {
    const startRaw = new Date(startDate);
    const endRaw = new Date(endDate);
    if (Number.isNaN(startRaw.getTime()) || Number.isNaN(endRaw.getTime())) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid start or end date." } },
        { status: 400 },
      );
    }
    window = {
      start: new Date(
        Date.UTC(startRaw.getUTCFullYear(), startRaw.getUTCMonth(), startRaw.getUTCDate(), 0, 0, 0, 0),
      ).toISOString(),
      end: new Date(
        Date.UTC(endRaw.getUTCFullYear(), endRaw.getUTCMonth(), endRaw.getUTCDate(), 23, 59, 59, 999),
      ).toISOString(),
    };
    if (Date.parse(window.start) > Date.parse(window.end)) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "The start date must be on or before the end date.",
          },
        },
        { status: 400 },
      );
    }
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

    const runInput = {
      token,
      workspaceId,
      actorId: user.id,
      now: now.toISOString(),
      runLabel,
      window,
      sections,
      reportLength,
      customPrompt,
    };

    // 0145 — insert the 'running' row (rejects a concurrent run with CONFLICT),
    // then hand the A→G pipeline to a background task so the response returns
    // immediately. The run survives refresh; the client polls GET for progress.
    const { runId } = await startAnalysis(runInput);
    after(() =>
      executeAnalysis(runId, runInput).catch((err) => {
        console.error("[pma] background run failed", runId, err);
      }),
    );
    return NextResponse.json({ runId, status: "running" }, { status: 202 });
  } catch (err) {
    const e = StructuredError.fromUnknown(err);
    return NextResponse.json({ error: e.toJSON() }, { status: statusFor(e.code) });
  }
}

// 0145 — poll a workspace's run state. Any member may read (RLS-enforced via
// getWorkspace). Reaps a dead in-flight run first (its function was killed and
// the heartbeat went stale), so a hung run self-heals to 'error' on the next
// poll. Returns the active run (if any) plus the full history.
export async function GET(req: Request) {
  await requireUser();
  const token = (await getSessionToken())!;
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "workspaceId is required." } },
      { status: 400 },
    );
  }
  try {
    const ws = await getWorkspace(token, workspaceId);
    if (!ws) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Workspace not found." } },
        { status: 404 },
      );
    }
    const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();
    await reapStaleRuns(workspaceId, staleBefore).catch(() => 0);
    const [active, runs] = await Promise.all([
      getActiveRun(workspaceId),
      listRuns(workspaceId),
    ]);
    return NextResponse.json({
      active: active ? serializeRun(active) : null,
      runs: runs.map(serializeRun),
    });
  } catch (err) {
    const e = StructuredError.fromUnknown(err);
    return NextResponse.json({ error: e.toJSON() }, { status: statusFor(e.code) });
  }
}
