import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listAllAcrossWorkspaces } from "@/lib/queries/cards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { MeTimelineView } from "@/components/me/me-timeline-view";

export const metadata = { title: "All workspaces timeline" };

// Common-space timeline: every workspace the caller can see, all cards
// with start + target dates, grouped by workspace then board. Reuses the
// MeTimelineView component (it's already workspace-grouped).
export default async function CommonTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const sp = await searchParams;

  const wsParam = typeof sp.ws === "string" ? sp.ws : "";
  const selectedWsIds = wsParam ? wsParam.split(",").filter(Boolean) : [];

  // Workspace filter must show EVERY workspace the caller can see, even
  // when it has zero cards with start + target dates. Union the two
  // sources so workspaces only reachable via board membership (no row in
  // workspace_members) still appear, AND empty workspaces still appear.
  const [allCards, memberWorkspaces] = await Promise.all([
    listAllAcrossWorkspaces(token),
    listWorkspaces(token),
  ]);
  const wsById = new Map<string, string>();
  for (const w of memberWorkspaces) wsById.set(w.id, w.name);
  for (const c of allCards) {
    if (!wsById.has(c.workspaceId)) wsById.set(c.workspaceId, c.workspaceName);
  }
  const workspaces = [...wsById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const cards =
    selectedWsIds.length > 0
      ? allCards.filter((c) => selectedWsIds.includes(c.workspaceId))
      : allCards;

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-6">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">COMMON / TIMELINE</span>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h1 className="serif-display text-5xl">All workspaces</h1>
          <span className="mono-meta text-fg-muted tabular-nums">
            {cards.length} CARDS
          </span>
        </div>
        <p className="text-sm text-fg-muted max-w-2xl">
          Every card with a start and target date, across every workspace
          you can see. Use the filter to scope to specific workspaces.
        </p>
        <Link
          href="/me/timeline"
          className="mono-meta-sm text-fg-muted hover:text-fg"
        >
          ← My timeline only
        </Link>
      </header>

      <MeTimelineWorkspaceFilter
        workspaces={workspaces}
        selected={selectedWsIds}
      />

      <MeTimelineView cards={cards} viewerId={user.id} />
    </div>
  );
}
