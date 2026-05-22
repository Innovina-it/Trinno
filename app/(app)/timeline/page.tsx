import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listAllAcrossWorkspaces } from "@/lib/queries/cards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { listEffectiveWorkspaceHolidays } from "@/lib/queries/workspace-holidays";
import { gridStartFor } from "@/lib/roadmap/dates";
import type { RoadmapCard } from "@/lib/queries/roadmap";
import { MeTimelineWorkspaceFilter } from "@/components/me/me-timeline-workspace-filter";
import { SharedAxisProvider } from "@/lib/roadmap/shared-axis";
import { TimelineChrome } from "@/components/timeline/timeline-chrome";
import { TimelineBands, type TimelineBand } from "@/components/timeline/timeline-bands";

export const metadata = { title: "Workspace timelines" };

// Workspace timelines: the canonical roadmap surface, one band per workspace
// the caller can see, ordered by the earliest scheduled card across the page
// (workspaces with nothing scheduled are dropped). Bands share a time axis
// via SharedAxisProvider so May 1 lines up vertically across every band, and
// scrolling one band scrolls all of them. Zoom + filters travel through the
// URL grammar each RoadmapView already reads.
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
  // is only a board-member, not a workspace-member). Without the union we'd
  // miss board-only workspaces that the previous flat-list page handled.
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
  // per-workspace data. Empty filter = every visible workspace.
  const visibleWsIds =
    selectedWsIds.length > 0
      ? allWorkspaces.filter((w) => selectedWsIds.includes(w.id)).map((w) => w.id)
      : allWorkspaces.map((w) => w.id);

  // Per-workspace fetches: snapshot powers the store (cards / lists /
  // members / sprints / links / sub-boards) and holidays feed the canvas
  // overlays. Parallel across workspaces; each call is RLS-scoped.
  const wsData = await Promise.all(
    visibleWsIds.map(async (id) => {
      const [snapshot, holidays] = await Promise.all([
        getWorkspaceSnapshot(token, id),
        listEffectiveWorkspaceHolidays(token, id),
      ]);
      return {
        id,
        name: wsByIdName.get(id) ?? id,
        snapshot,
        holidays,
      };
    }),
  );

  // Scheduled cards per workspace — used both to compute earliest-start
  // ordering and to drop empty bands. A workspace with no start+target
  // cards has nothing to render in the gantt.
  type ScheduledRef = { startMs: number; endMs: number };
  function scheduledCards(snap: (typeof wsData)[number]["snapshot"]): ScheduledRef[] {
    const out: ScheduledRef[] = [];
    for (const c of snap.cards) {
      if (!c.startDate || !c.targetDate || c.archived) continue;
      out.push({
        startMs: new Date(c.startDate).getTime(),
        endMs: new Date(c.targetDate).getTime(),
      });
    }
    return out;
  }

  const bands = wsData
    .map((w) => {
      const sched = scheduledCards(w.snapshot);
      if (sched.length === 0) return null;
      const earliestStart = sched.reduce(
        (acc, s) => (s.startMs < acc ? s.startMs : acc),
        Number.POSITIVE_INFINITY,
      );
      const latestEnd = sched.reduce(
        (acc, s) => (s.endMs > acc ? s.endMs : acc),
        Number.NEGATIVE_INFINITY,
      );
      return { ...w, earliestStart, latestEnd, cardCount: sched.length };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.earliestStart - b.earliestStart);

  // Serializable shape handed to the TimelineBands client component. Dates
  // travel as ISO strings because Date instances don't survive the server
  // → client prop boundary cleanly.
  const timelineBands: TimelineBand[] = bands.map((b) => ({
    id: b.id,
    name: b.name,
    cardCount: b.cardCount,
    earliestStart: new Date(b.earliestStart).toISOString(),
    latestEnd: new Date(b.latestEnd).toISOString(),
    snapshot: b.snapshot,
    holidays: b.holidays,
  }));

  // Aggregated scheduled cards across every visible band, mapped to
  // RoadmapCard so the page-level RoadmapMiniMap can render the same
  // density bars + viewport rect it draws on /w/:ws/roadmap. Board title
  // is resolved per workspace; roadmapOrder is unused cross-WS but kept
  // for shape parity.
  const aggregatedCards: RoadmapCard[] = bands.flatMap((b) => {
    const titles = new Map(b.snapshot.boards.map((bd) => [bd.id, bd.title]));
    return b.snapshot.cards
      .filter((c) => c.startDate && c.targetDate && !c.archived)
      .map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        parentCardId: c.parentCardId,
        startDate: c.startDate as Date,
        targetDate: c.targetDate as Date,
        boardId: c.boardId,
        boardTitle: titles.get(c.boardId) ?? "",
        archived: c.archived,
        roadmapOrder: c.roadmapOrder,
        priority: c.priority,
        completedAt: c.completedAt,
      }));
  });

  // Global axis range auto-fits the data span: start snaps to the first
  // day of the earliest card's month so the first tick is a clean month
  // boundary; end snaps up to the first of the month AFTER the latest
  // target so the right edge ends on a clean tick. No artificial 180-day
  // window — `effectivePpd` in RoadmapView divides by this range, so the
  // canvas auto-scales to whatever data span exists.
  const fallbackNow = Date.now();
  const earliest = bands.reduce(
    (acc, b) => (b.earliestStart < acc ? b.earliestStart : acc),
    fallbackNow,
  );
  const latest = bands.reduce(
    (acc, b) => (b.latestEnd > acc ? b.latestEnd : acc),
    fallbackNow,
  );
  const rangeStart = gridStartFor(new Date(earliest), "fit");
  const latestDate = new Date(latest);
  const rangeEnd = new Date(
    Date.UTC(
      latestDate.getUTCFullYear(),
      latestDate.getUTCMonth() + 1,
      1,
    ),
  );
  const range = { start: rangeStart, end: rangeEnd };

  return (
    <div className="mx-auto max-w-screen-2xl px-3 sm:px-4 md:px-6 py-5 md:py-7 space-y-5">
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

      {bands.length === 0 ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <MeTimelineWorkspaceFilter
              workspaces={allWorkspaces}
              selected={selectedWsIds}
            />
          </div>
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
        </>
      ) : (
        <SharedAxisProvider range={range}>
          {/* Page-level chrome reuses the SAME RoadmapHeader + RoadmapFilterBar
              that /w/:ws/roadmap renders, with workspace-only controls hidden
              via hide-flags. Workspace filter sits on its own row so it
              survives narrow viewports without crowding the toolbar. */}
          <div className="flex items-center gap-2 flex-wrap">
            <MeTimelineWorkspaceFilter
              workspaces={allWorkspaces}
              selected={selectedWsIds}
            />
          </div>
          <TimelineChrome
            bandIds={timelineBands.map((b) => b.id)}
            aggregatedCards={aggregatedCards}
          />

          <TimelineBands bands={timelineBands} viewerId={user.id} />
        </SharedAxisProvider>
      )}
    </div>
  );
}
