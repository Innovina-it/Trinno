import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/service-role";

const Body = z.object({ boardId: z.string().uuid() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid boardId" }, { status: 400 });
  }

  let admin;
  try {
    admin = getServiceSupabase();
  } catch {
    return NextResponse.json(
      { error: "Supabase env not configured" },
      { status: 500 },
    );
  }
  const { data, error } = await admin.rpc("scan_board_sla", {
    p_board_id: parsed.data.boardId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath(`/b/${parsed.data.boardId}`);
  revalidatePath(`/b/${parsed.data.boardId}/settings`);
  return NextResponse.json({ breachedActive: Number(data ?? 0) });
}
