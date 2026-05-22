"use client";
/**
 * TimelineBands — client shell that owns the URL `?collapsed=` state and
 * decides per band whether to mount a full RoadmapView or a CollapsedBand
 * strip. Lives between the server page and the band components so:
 *
 *   • The page stays a server component (fetches snapshots, holidays).
 *   • Collapse state is URL-driven (shareable links, no DB writes).
 *   • Collapsed bands skip their WorkspaceStoreProvider + realtime entirely,
 *     so collapsing is a real cost cut, not just a visual fold.
 */
import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { RoadmapView } from "@/components/roadmap/roadmap-view";
import { CollapsedBand } from "@/components/timeline/collapsed-band";

export type TimelineBand = {
  id: string;
  name: string;
  cardCount: number;
  earliestStart: string; // ISO — server passes serializable
  latestEnd: string;
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

  const collapsedIds = useMemo(() => {
    const c = sp.get("collapsed");
    if (!c) return new Set<string>();
    return new Set(c.split(",").filter(Boolean));
  }, [sp]);

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

  return (
    <div className="space-y-3" data-testid="timeline-bands">
      {bands.map((band) => {
        const isCollapsed = collapsedIds.has(band.id);
        return isCollapsed ? (
          <CollapsedBand
            key={band.id}
            name={band.name}
            href={`/w/${band.id}/roadmap`}
            cardCount={band.cardCount}
            earliestStart={new Date(band.earliestStart)}
            latestEnd={new Date(band.latestEnd)}
            onExpand={() => toggle(band.id)}
          />
        ) : (
          <WorkspaceStoreProvider key={band.id} initial={band.snapshot}>
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
            />
          </WorkspaceStoreProvider>
        );
      })}
    </div>
  );
}
