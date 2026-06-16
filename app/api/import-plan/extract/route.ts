import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extractPlanFromFile } from "@/lib/plan-import/extract";
import { isSupportedUpload, SUPPORTED_UPLOAD_LABEL } from "@/lib/plan-import/supported-types";
import { checkPdfSize } from "./size";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST a file (multipart/form-data, field "pdf" — name kept for compatibility).
// Server actions cannot receive File/FormData, so the wizard's upload step
// targets this route handler. The file is transient — never persisted to a
// bucket or Drive; it is only sent to Gemini for structure extraction. Accepts
// the Gemini-native set (PDF, images, text); Office docs are rejected (no
// conversion yet). Returns { plan } or { error }.
export async function POST(req: Request) {
  // requireUser() may redirect; keep it outside the catch so the redirect isn't
  // swallowed. Everything else is wrapped so any failure (form parse, read,
  // extraction) is logged and returned as a readable message, never a bare 500.
  await requireUser();

  try {
    const form = await req.formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (!isSupportedUpload(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type. Upload a ${SUPPORTED_UPLOAD_LABEL} (export Word/Excel as PDF first).`,
        },
        { status: 415 },
      );
    }
    const tooBig = checkPdfSize(file.size);
    if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const plan = await extractPlanFromFile(bytes, file.type);
    return NextResponse.json({ plan });
  } catch (e) {
    console.error("[import-plan/extract] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed." },
      { status: 502 },
    );
  }
}
