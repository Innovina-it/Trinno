import { NextResponse } from "next/server";

import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors/structured-error";
import { runAnalysis } from "@/lib/pma/run";
import { sanitizeReportSections } from "@/lib/pma/report-sections";
import {
  sanitizeReportLength,
  sanitizeCustomPrompt,
  type ReportLength,
} from "@/lib/pma/report-settings";

// PMA U9 — "Run analysis" route (DESIGN §3, §6). Owner/admin only. Thin: auth +
// role gate + parse → delegate to runAnalysis (the A→G pipeline). A run can take
// tens of seconds (Gemini Flash synthesis), so allow the platform max duration.
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

    const result = await runAnalysis({
      token,
      workspaceId,
      actorId: user.id,
      now: now.toISOString(),
      runLabel,
      window,
      sections,
      reportLength,
      customPrompt,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const e = StructuredError.fromUnknown(err);
    return NextResponse.json({ error: e.toJSON() }, { status: statusFor(e.code) });
  }
}
