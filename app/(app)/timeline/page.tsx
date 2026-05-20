import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listAllAcrossWorkspaces } from "@/lib/queries/cards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { CommonRoadmapView } from "@/components/timeline/common-roadmap-view";

export const metadata = { title: "Common roadmap" };

// Common roadmap: every workspace the caller can see, rendered as a
// cross-workspace gantt. Each workspace is a collapsible swimlane band
// over a shared time axis. Bar grammar mirrors the per-workspace roadmap.
export default async function CommonTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  await requireUser();
  const token = (await getSessionToken())!;
  const sp = await searchParams;

  const wsParam = typeof sp.ws === "string" ? sp.ws : "";
  const selectedWsIds = wsParam ? wsParam.split(",").filter(Boolean) : [];

  // The workspace filter must list every workspace the caller can see —
  // even ones with zero scheduled cards. Union memberships with the cards'
  // own workspace metadata so board-only memberships still surface.
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
  const scopedWorkspaces =
    selectedWsIds.length > 0
      ? workspaces.filter((w) => selectedWsIds.includes(w.id))
      : workspaces;

  return (
    <div className="mx-auto max-w-screen-2xl px-3 sm:px-4 md:px-6 py-5 md:py-7 space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <span className="mono-meta-sm tracking-widest text-fg-faint">
            COMMON / ROADMAP
          </span>
          <h1 className="serif-display text-3xl md:text-4xl leading-none">
            All workspaces
          </h1>
        </div>
        <Link
          href="/me/timeline"
          className="mono-meta-sm tracking-widest text-fg-muted hover:text-fg"
        >
          MY TIMELINE →
        </Link>
      </header>

      <MeTimelineWorkspaceFilter
        workspaces={workspaces}
        selected={selectedWsIds}
      />

      <CommonRoadmapView
        cards={cards}
        allWorkspaces={scopedWorkspaces}
      />
    </div>
  );
}
