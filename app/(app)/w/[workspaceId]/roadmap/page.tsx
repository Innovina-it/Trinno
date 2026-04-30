import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listRoadmapCards, listRoadmapLinks } from "@/lib/queries/roadmap";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { RoadmapView } from "@/components/roadmap/roadmap-view";

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const [cards, links, snapshot] = await Promise.all([
    listRoadmapCards(token, workspaceId),
    listRoadmapLinks(token, workspaceId),
    getWorkspaceSnapshot(token, workspaceId),
  ]);

  return (
    <WorkspaceStoreProvider initial={snapshot}>
      <div className="mx-auto max-w-7xl px-6 py-10 space-y-8">
        <header className="space-y-3 border-b border-hairline pb-6">
          <span className="chip">{ws.name.toUpperCase()} / ROADMAP</span>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="serif-display text-5xl">Roadmap</h1>
            <span
              className="mono-meta text-fg-muted"
              data-testid="roadmap-card-count"
            >
              {cards.length} CARDS
            </span>
          </div>
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
        </header>
        <RoadmapView
          initialCards={cards}
          initialLinks={links}
          workspaceId={workspaceId}
        />
      </div>
    </WorkspaceStoreProvider>
  );
}
