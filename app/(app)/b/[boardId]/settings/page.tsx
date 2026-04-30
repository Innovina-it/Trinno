import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { BoardSettingsForm } from "@/components/board/board-settings-form";
import { ListsAdminPanel } from "@/components/board/lists-admin-panel";

export default async function BoardSettingsPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const snap = await getBoardSnapshot(token, boardId);
  if (!snap) notFound();
  const b = snap.board;
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
      <section className="space-y-4">
        <h2 className="mono-meta">Lists</h2>
        <ListsAdminPanel
          lists={snap.lists.map((l) => ({
            id: l.id,
            title: l.title,
            wipLimit: l.wipLimit ?? null,
          }))}
        />
      </section>
    </div>
  );
}
