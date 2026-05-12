import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { listAssignedAcrossWorkspaces } from "@/lib/queries/cards";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { MeTimelineView } from "@/components/me/me-timeline-view";

export const metadata = { title: "My timeline" };

export default async function MeTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const sp = await searchParams;

  // Workspace filter: comma-separated workspace IDs from ?ws=...
  const wsParam = typeof sp.ws === "string" ? sp.ws : "";
  const selectedWsIds = wsParam ? wsParam.split(",").filter(Boolean) : [];

  const [workspaces, cards] = await Promise.all([
    listWorkspaces(token),
    listAssignedAcrossWorkspaces(
      token,
      selectedWsIds.length > 0 ? selectedWsIds : undefined,
    ),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-6">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">HOME / TIMELINE</span>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h1 className="serif-display text-5xl">My timeline</h1>
          <span className="mono-meta text-fg-muted tabular-nums">
            {cards.length} CARDS
          </span>
        </div>
        <p className="text-sm text-fg-muted max-w-2xl">
          Cards assigned to you (as owner or member) that have both a start date
          and a target date, across all workspaces you belong to.
        </p>
        <Link
          href="/me"
          className="mono-meta-sm text-fg-muted hover:text-fg"
        >
          ← Back to home
        </Link>
      </header>

      {/* Workspace multi-select filter */}
      <MeTimelineWorkspaceFilter
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
        selected={selectedWsIds}
      />

      {/* Timeline grouped by workspace → board */}
      <MeTimelineView cards={cards} viewerId={user.id} />
    </div>
  );
}
