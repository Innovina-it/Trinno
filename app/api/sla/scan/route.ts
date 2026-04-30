import { NextResponse } from "next/server";
import { z } from "zod";
import { scanBoardSla } from "@/actions/sla";

const Body = z.object({ boardId: z.string().uuid() });

export async function POST(req: Request) {
  const body = Body.parse(await req.json().catch(() => ({})));
  const r = await scanBoardSla({ boardId: body.boardId });
  return NextResponse.json(r);
}
