import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoard } from "@/lib/queries/boards";
import { BoardSettingsForm } from "@/components/board/board-settings-form";

export default async function BoardSettingsPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await getBoard(token, boardId);
  if (!b) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold">{b.title} — Board settings</h1>
      <BoardSettingsForm
        board={{
          id: b.id,
          title: b.title,
          archived: b.archived,
          workspaceId: b.workspaceId,
        }}
      />
    </div>
  );
}
