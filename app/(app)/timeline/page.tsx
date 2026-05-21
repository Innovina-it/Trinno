import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listAllAcrossWorkspaces } from "@/lib/queries/cards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { parseFilters } from "@/lib/board-filters";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { CommonRoadmapFilterBar } from "@/components/timeline/common-roadmap-filter-bar";
import { CommonRoadmapView } from "@/components/timeline/common-roadmap-view";

export const metadata = { title: "Common roadmap" };

// Workspace timelines: every workspace the caller can see, flattened into a
// single chronological list (start date ASC). Bar grammar mirrors the
// per-workspace roadmap; type + hide-completed filters travel through the
// shared URL grammar (lib/board-filters). Sprint/label/overdue are skipped
// on purpose — they don't commute across workspaces or aren't carried by
// CrossWorkspaceCard.
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

  // Build a URLSearchParams view of the incoming search params so we can
  // reuse the shared filter parser without re-implementing key handling.
  const filterParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") filterParams.set(k, v);
    else if (Array.isArray(v) && v.length > 0)
      filterParams.set(k, v[v.length - 1]);
  }
  const filters = parseFilters(filterParams);

  // Workspace filter dropdown must list every workspace the caller can see,
  // even ones with zero scheduled cards — union memberships with the cards'
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

  const wsFiltered =
    selectedWsIds.length > 0
      ? allCards.filter((c) => selectedWsIds.includes(c.workspaceId))
      : allCards;
  const cards = wsFiltered.filter((c) => {
    if (filters.types.length && !filters.types.includes(c.type)) return false;
    if (filters.hideCompleted && c.completedAt != null) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-screen-2xl px-3 sm:px-4 md:px-6 py-5 md:py-7 space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <span className="mono-meta-sm tracking-widest text-fg-faint">
            COMMON / ROADMAP
          </span>
          <h1 className="serif-display text-3xl md:text-4xl leading-none">
            Workspace timelines
          </h1>
        </div>
        <Link
          href="/me/timeline"
          className="mono-meta-sm tracking-widest text-fg-muted hover:text-fg"
        >
          MY TIMELINE →
        </Link>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <MeTimelineWorkspaceFilter
          workspaces={workspaces}
          selected={selectedWsIds}
        />
        <span aria-hidden className="text-fg-faint">·</span>
        <CommonRoadmapFilterBar />
      </div>

      <CommonRoadmapView cards={cards} />
    </div>
  );
}
