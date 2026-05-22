"use client";
/**
 * CollapsedBand — compact strip representing a folded workspace on /timeline.
 *
 * When a user collapses a workspace band, the page renders this strip in
 * place of the full RoadmapView. The full band's WorkspaceStoreProvider,
 * realtime channel, drag harness, and milestone fetch are NOT mounted —
 * collapsing is also a real cost cut for users with many workspaces.
 *
 * Visual: a single horizontal row matching the band's "filled with quiet"
 * grammar. Workspace name in mono-meta uppercase + scheduled card count +
 * earliest/latest range chip. Click anywhere expands.
 */
import { ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/format-date";

export function CollapsedBand({
  name,
  href,
  cardCount,
  earliestStart,
  latestEnd,
  onExpand,
}: {
  name: string;
  href?: string;
  cardCount: number;
  earliestStart: Date;
  latestEnd: Date;
  onExpand: () => void;
}) {
  void href;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full text-left rounded-xl border border-hairline bg-[color:var(--bg-2)] hover:bg-[color:var(--surface-strong)] hover:border-hairline-hi transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 flex items-center gap-3 px-3 py-3"
      data-testid="timeline-collapsed-band"
      aria-label={`Expand ${name}`}
    >
      <ChevronDown
        className="size-4 text-fg-muted shrink-0"
        aria-hidden
      />
      <span className="mono-meta tracking-[0.14em] text-fg truncate min-w-0">
        {name.toUpperCase()}
      </span>
      <span aria-hidden className="text-fg-faint">·</span>
      <span className="mono-meta-sm tracking-widest text-fg-muted tabular-nums shrink-0">
        {cardCount} {cardCount === 1 ? "CARD" : "CARDS"}
      </span>
      <span aria-hidden className="text-fg-faint hidden sm:inline">·</span>
      <span className="mono-meta-sm tracking-widest text-fg-faint tabular-nums shrink-0 hidden sm:inline">
        {formatDate(earliestStart)} → {formatDate(latestEnd)}
      </span>
    </button>
  );
}
