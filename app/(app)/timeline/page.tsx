import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/concurrency";
import { listAllAcrossWorkspaces, MAX_CROSS_WS_CARDS } from "@/lib/queries/cards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { listEffectiveWorkspaceHolidays } from "@/lib/queries/workspace-holidays";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { TimelineBands, type TimelineBand } from "@/components/timeline/timeline-bands";

export const metadata = { title: "All Workspace Timelines" };

// Workspace timelines: one band per workspace the caller can see. The
// server hands TimelineBands a raw list with full snapshots; the client
// applies URL filters, drops bands whose visible cards collapse to zero,
// sorts bands by earliest visible start, and recomputes axis range from
// the filtered set — so changing `?assignee=`, `?type=`, etc. shrinks
// the canvas to fit the matching data instead of leaving empty band
// frames inside the unfiltered window.
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

  // Workspace discovery: union membership (listWorkspaces) with card
  // visibility (listAllAcrossWorkspaces surfaces workspaces where the user
  // is only a board-member, not a workspace-member).
  const [memberWorkspaces, allCards] = await Promise.all([
    listWorkspaces(token),
    listAllAcrossWorkspaces(token),
  ]);
  const wsByIdName = new Map<string, string>();
  for (const w of memberWorkspaces) wsByIdName.set(w.id, w.name);
  for (const c of allCards) {
    if (!wsByIdName.has(c.workspaceId))
      wsByIdName.set(c.workspaceId, c.workspaceName);
  }
  const allWorkspaces = [...wsByIdName.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Apply the ?ws= filter (multi-select chip) before fetching heavy
  // per-workspace data. URL filters (type/assignee/etc.) are applied
  // client-side inside TimelineBands.
  const candidateWsIds =
    selectedWsIds.length > 0
      ? allWorkspaces.filter((w) => selectedWsIds.includes(w.id)).map((w) => w.id)
      : allWorkspaces.map((w) => w.id);

  // Only workspaces with at least one scheduled card get the heavy
  // snapshot fetch — allCards is already exactly the scheduled set
  // (dated, non-archived), so a workspace absent from it can only
  // produce an empty band, which the render below drops anyway. When
  // the cross-workspace card cap truncates allCards it stops being a
  // complete index, so fall back to fetching every candidate.
  const scheduledWsIds = new Set(allCards.map((c) => c.workspaceId));
  const allCardsTruncated = allCards.length >= MAX_CROSS_WS_CARDS;
  const visibleWsIds = candidateWsIds.filter(
    (id) => allCardsTruncated || scheduledWsIds.has(id),
  );

  // Bounded fan-out: each snapshot + holidays pair holds DB connections
  // for its whole transaction, so an unbounded Promise.all over every
  // workspace can drain the shared pool and starve auth/realtime too
  // (the 2026-06-11 prod 504 cascade).
  const wsData = await mapWithConcurrency(visibleWsIds, 3, async (id) => {
    const [snapshot, holidays] = await Promise.all([
      getWorkspaceSnapshot(token, id, "active"),
      listEffectiveWorkspaceHolidays(token, id),
    ]);
    return {
      id,
      name: wsByIdName.get(id) ?? id,
      snapshot,
      holidays,
    };
  });

  // Bands with NO scheduled cards at all are dropped server-side — they
  // can't match any filter so there's no reason to ship the snapshot.
  // Bands with cards but where every card fails the active filter will
  // be dropped client-side inside TimelineBands.
  const timelineBands: TimelineBand[] = wsData
    .filter((w) =>
      w.snapshot.cards.some(
        (c) => c.startDate && c.targetDate && !c.archived,
      ),
    )
    .map((w) => ({
      id: w.id,
      name: w.name,
      snapshot: w.snapshot,
      holidays: w.holidays,
    }));

  return (
    <div className="mx-auto max-w-screen-2xl px-3 sm:px-4 md:px-6 py-5 md:py-7 flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <span className="mono-meta-sm tracking-widest text-fg-faint">
            COMMON / ROADMAP
          </span>
          <h1 className="serif-display text-3xl md:text-4xl leading-none">
            All Workspace Timelines
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
          workspaces={allWorkspaces}
          selected={selectedWsIds}
        />
      </div>

      {timelineBands.length === 0 ? (
        <div
          className="relative min-h-[40vh] grid place-items-center text-center"
          data-testid="timeline-empty"
        >
          <div className="space-y-3 max-w-md">
            <p className="serif-display text-4xl">Nothing scheduled.</p>
            <p className="text-sm text-fg-muted">
              No workspace has cards with both a start and a target date.
              Add dates to a card on any board to see it here.
            </p>
          </div>
        </div>
      ) : (
        <TimelineBands bands={timelineBands} viewerId={user.id} />
      )}
    </div>
  );
}
