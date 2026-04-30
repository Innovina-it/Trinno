import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { listSlaPoliciesForBoard } from "@/lib/queries/sla";
import { BoardSettingsForm } from "@/components/board/board-settings-form";
import { ListsAdminPanel } from "@/components/board/lists-admin-panel";
import { SlaPoliciesPanel } from "@/components/board/sla-policies-panel";
import { ComponentsPanel } from "@/components/components/components-panel";
import { listFavoriteBoardIds } from "@/lib/queries/favorites";

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
  const slaPolicies = await listSlaPoliciesForBoard(token, boardId);
  const favoritedIds = await listFavoriteBoardIds(token);
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
        favorited={favoritedIds.includes(b.id)}
      />
      <section className="space-y-4">
        <h2 className="mono-meta">Lists</h2>
        <ListsAdminPanel
          lists={snap.lists.map((l) => ({
            id: l.id,
            title: l.title,
            wipLimit: l.wipLimit ?? null,
            statusKind: l.statusKind ?? null,
          }))}
        />
      </section>
      <section className="space-y-4">
        <h2 className="mono-meta">SLAs</h2>
        <SlaPoliciesPanel
          boardId={boardId}
          initial={slaPolicies.map((p) => ({
            id: p.id,
            name: p.name,
            targetMin: p.targetMin,
            enabled: p.enabled,
          }))}
        />
      </section>
      <section className="space-y-4">
        <h2 className="mono-meta">Components</h2>
        <ComponentsPanel boardId={boardId} />
      </section>
    </div>
  );
}
