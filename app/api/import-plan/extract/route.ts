import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extractPlanFromPdf } from "@/lib/plan-import/extract";
import { checkPdfSize } from "./size";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST a PDF (multipart/form-data, field "pdf"). Server actions cannot receive
// File/FormData, so the wizard's upload step targets this route handler. The
// PDF is transient — never persisted to a bucket or Drive; it is only sent to
// Gemini for structure extraction. Returns { plan } or { error }.
export async function POST(req: Request) {
  // requireUser() may redirect; keep it outside the catch so the redirect isn't
  // swallowed. Everything else is wrapped so any failure (form parse, read,
  // extraction) is logged and returned as a readable message, never a bare 500.
  await requireUser();

  try {
    const form = await req.formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
    }
    const tooBig = checkPdfSize(file.size);
    if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const plan = await extractPlanFromPdf(bytes);
    return NextResponse.json({ plan });
  } catch (e) {
    console.error("[import-plan/extract] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed." },
      { status: 502 },
    );
  }
}
