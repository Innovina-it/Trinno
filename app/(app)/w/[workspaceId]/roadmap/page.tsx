import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { listEffectiveWorkspaceHolidays } from "@/lib/queries/workspace-holidays";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { RoadmapView } from "@/components/roadmap/roadmap-view";

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const [snapshot, holidays] = await Promise.all([
    // "active" matches the /w layout's call — same args, one deduped fetch.
    getWorkspaceSnapshot(token, workspaceId, "active"),
    listEffectiveWorkspaceHolidays(token, workspaceId),
  ]);
  // Crumb count: derive from the snapshot we already loaded instead of a
  // separate listRoadmapCards query. Replicates that query's predicate —
  // non-archived (the "active" snapshot already drops archived cards),
  // non-milestone, both dates set — capped at its same 200 ceiling.
  const roadmapCardCount = Math.min(
    snapshot.cards.filter(
      (c) => c.type !== "milestone" && c.startDate && c.targetDate,
    ).length,
    200,
  );

  return (
    <WorkspaceStoreProvider initial={snapshot}>
      <div className="px-3 sm:px-4 md:px-6 pt-3 md:pt-5 pb-6 md:pb-10 space-y-4 md:space-y-6">
        {/* Operator-console crumb. One line, mono-meta, all the metadata
            the page header used to need. The actual page IS the gantt; the
            crumb earns its keep, nothing else does. */}
        <header
          className="flex items-center gap-2 text-fg-muted"
          data-testid="roadmap-crumb"
        >
          <Link
            href={`/w/${workspaceId}`}
            className="inline-flex items-center gap-1 rounded-md min-h-9 px-1 -mx-1 text-fg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [@media(hover:none)_and_(pointer:coarse)]:min-h-11"
            aria-label="Back to workspace"
            title={ws.name}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            <span className="mono-meta-sm tracking-[0.14em] truncate max-w-[8rem] sm:max-w-[16rem]">
              {ws.name.toUpperCase()}
            </span>
          </Link>
          <span aria-hidden className="mono-meta-sm text-fg-faint">/</span>
          <span className="mono-meta-sm tracking-[0.14em] text-fg">
            ROADMAP
          </span>
          <span aria-hidden className="mono-meta-sm text-fg-faint">·</span>
          <span
            className="mono-meta-sm tracking-[0.14em] text-fg-muted tabular-nums"
            data-testid="roadmap-card-count"
          >
            {roadmapCardCount} CARDS
          </span>
        </header>
        <RoadmapView
          workspaceId={workspaceId}
          viewerId={user.id}
          holidays={holidays}
        />
      </div>
    </WorkspaceStoreProvider>
  );
}
