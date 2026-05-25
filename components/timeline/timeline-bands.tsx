"use client";
/**
 * TimelineBands — unified client root for /timeline.
 *
 * Owns every piece of state that depends on URL filters, because the
 * server can't know the URL's filter params before the client renders:
 *
 *   • Filter-aware band visibility — bands whose scheduled cards all fail
 *     the active filter are dropped (no empty band frames sitting around
 *     when the user picks "Mine" or types in search).
 *   • Filter-aware axis range — gridStart/gridEnd recompute from the
 *     visible-after-filter cards, so the canvas auto-fits to the matching
 *     span instead of stretching across the unfiltered window.
 *   • Filter-aware aggregated cards for the page-level mini-map.
 *   • Collapse state via ?collapsed= URL param.
 *
 * Mounts SharedAxisProvider + TimelineChrome + the band stack itself so
 * the computed range + aggregatedCards reach every consumer without
 * re-prop-drilling through the server boundary.
 */
import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { RoadmapView } from "@/components/roadmap/roadmap-view";
import { CollapsedBand } from "@/components/timeline/collapsed-band";
import { TimelineChrome } from "@/components/timeline/timeline-chrome";
import { SharedAxisProvider } from "@/lib/roadmap/shared-axis";
import { parseFilters } from "@/lib/board-filters";
import { roadmapUserFilterPasses } from "@/lib/roadmap/filtering";
import { gridStartFor } from "@/lib/roadmap/dates";
import type { RoadmapCard } from "@/lib/queries/roadmap";

export type TimelineBand = {
  id: string;
  name: string;
  snapshot: WorkspaceSnapshot;
  holidays: ReadonlyArray<{ iso: string; name: string }>;
};

export function TimelineBands({
  bands,
  viewerId,
}: {
  bands: TimelineBand[];
  viewerId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  // --- URL state ---
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const queryNorm = (sp.get("q") ?? "").trim().toLowerCase();
  const collapsedIds = useMemo(() => {
    const c = sp.get("collapsed");
    if (!c) return new Set<string>();
    return new Set(c.split(",").filter(Boolean));
  }, [sp]);

  // --- Per-band filter pass ---
  // For each band, walk its snapshot.cards, keep cards that have both
  // dates + survive the active filter. memberByCard is rebuilt locally
  // because Maps don't survive the server→client prop boundary.
  type VisibleBand = {
    band: TimelineBand;
    visibleCards: RoadmapCard[];
    earliestStartMs: number;
    latestEndMs: number;
  };
  const visibleBands = useMemo<VisibleBand[]>(() => {
    const out: VisibleBand[] = [];
    for (const band of bands) {
      const memberByCard = new Map<string, Set<string>>();
      for (const m of band.snapshot.cardMembers) {
        const set = memberByCard.get(m.cardId) ?? new Set<string>();
        set.add(m.userId);
        memberByCard.set(m.cardId, set);
      }
      const titles = new Map(
        band.snapshot.boards.map((bd) => [bd.id, bd.title]),
      );
      const visibleCards: RoadmapCard[] = [];
      for (const c of band.snapshot.cards) {
        if (!c.startDate || !c.targetDate || c.archived) continue;
        // hideCompleted is roadmap-bar-specific (not in roadmapUserFilterPasses).
        if (filters.hideCompleted && c.completedAt != null) continue;
        const passes = roadmapUserFilterPasses(c, {
          queryNorm,
          filters,
          sprintFilter: "", // sprint IDs don't commute cross-workspace
          viewerId,
          memberByCard,
        });
        if (!passes) continue;
        visibleCards.push({
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
        });
      }
      if (visibleCards.length === 0) continue;
      const earliest = visibleCards.reduce(
        (acc, c) => (c.startDate.getTime() < acc ? c.startDate.getTime() : acc),
        Number.POSITIVE_INFINITY,
      );
      const latest = visibleCards.reduce(
        (acc, c) => (c.targetDate.getTime() > acc ? c.targetDate.getTime() : acc),
        Number.NEGATIVE_INFINITY,
      );
      out.push({
        band,
        visibleCards,
        earliestStartMs: earliest,
        latestEndMs: latest,
      });
    }
    out.sort((a, b) => a.earliestStartMs - b.earliestStartMs);
    return out;
  }, [bands, filters, queryNorm, viewerId]);

  // --- Filter-aware aggregate range + cards ---
  const range = useMemo(() => {
    const now = Date.now();
    if (visibleBands.length === 0) {
      return { start: new Date(now), end: new Date(now + 30 * 86_400_000) };
    }
    const earliest = visibleBands.reduce(
      (acc, b) => (b.earliestStartMs < acc ? b.earliestStartMs : acc),
      Number.POSITIVE_INFINITY,
    );
    const latest = visibleBands.reduce(
      (acc, b) => (b.latestEndMs > acc ? b.latestEndMs : acc),
      Number.NEGATIVE_INFINITY,
    );
    const start = gridStartFor(new Date(earliest), "fit");
    const latestDate = new Date(latest);
    const end = new Date(
      Date.UTC(
        latestDate.getUTCFullYear(),
        latestDate.getUTCMonth() + 1,
        1,
      ),
    );
    return { start, end };
  }, [visibleBands]);

  const aggregatedCards = useMemo<RoadmapCard[]>(
    () => visibleBands.flatMap((b) => b.visibleCards),
    [visibleBands],
  );

  // --- Collapse toggle ---
  const writeCollapsed = useCallback(
    (next: Set<string>) => {
      const params = new URLSearchParams(sp.toString());
      if (next.size === 0) params.delete("collapsed");
      else params.set("collapsed", [...next].join(","));
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, sp],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(collapsedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(next);
    },
    [collapsedIds, writeCollapsed],
  );

  if (visibleBands.length === 0) {
    return (
      <>
        <TimelineChrome bandIds={[]} aggregatedCards={[]} />
        <div
          className="relative min-h-[40vh] grid place-items-center text-center"
          data-testid="timeline-empty-filtered"
        >
          <div className="space-y-3 max-w-md">
            <p className="serif-display text-4xl">No matches.</p>
            <p className="text-sm text-fg-muted">
              No card across any workspace matches the current filter.
              Clear filters to see everything scheduled.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Last expanded band absorbs leftover viewport vertical space via
  // `fillHeight` + a `flex-1` wrapper, so filters that narrow the canvas to
  // a few lanes don't leave a stark dark void below the band. Earlier bands
  // and collapsed strips keep their natural intrinsic height.
  let lastExpandedIdx = -1;
  for (let i = visibleBands.length - 1; i >= 0; i--) {
    if (!collapsedIds.has(visibleBands[i].band.id)) {
      lastExpandedIdx = i;
      break;
    }
  }

  return (
    <SharedAxisProvider range={range}>
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        <TimelineChrome
          bandIds={visibleBands.map((v) => v.band.id)}
          aggregatedCards={aggregatedCards}
        />
        <div
          className="flex flex-col flex-1 min-h-0 gap-3"
          data-testid="timeline-bands"
        >
          {visibleBands.map(
            ({ band, visibleCards, earliestStartMs, latestEndMs }, idx) => {
              const isCollapsed = collapsedIds.has(band.id);
              if (isCollapsed) {
                return (
                  <CollapsedBand
                    key={band.id}
                    name={band.name}
                    href={`/w/${band.id}/roadmap`}
                    cardCount={visibleCards.length}
                    earliestStart={new Date(earliestStartMs)}
                    latestEnd={new Date(latestEndMs)}
                    onExpand={() => toggle(band.id)}
                  />
                );
              }
              const isLastExpanded = idx === lastExpandedIdx;
              return (
                <div
                  key={band.id}
                  className={
                    isLastExpanded
                      ? "flex flex-col flex-1 min-h-0"
                      : "flex flex-col"
                  }
                >
                  <WorkspaceStoreProvider initial={band.snapshot}>
                    <RoadmapView
                      workspaceId={band.id}
                      viewerId={viewerId}
                      holidays={band.holidays}
                      workspaceColumn={{
                        name: band.name,
                        href: `/w/${band.id}/roadmap`,
                      }}
                      hideChrome
                      onCollapse={() => toggle(band.id)}
                      compactLanes
                      fillHeight={isLastExpanded}
                    />
                  </WorkspaceStoreProvider>
                </div>
              );
            },
          )}
        </div>
      </div>
    </SharedAxisProvider>
  );
}
