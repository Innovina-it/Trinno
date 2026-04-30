import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { releaseNotesMarkdown } from "@/lib/queries/versions";

export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; versionId: string }> },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const { versionId } = await params;
  const md = await releaseNotesMarkdown(token, versionId);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="release-notes.md"`,
    },
  });
}
