"use client";
/**
 * Cross-workspace timeline view for /me/timeline.
 *
 * Renders cards grouped by workspace → board with a lightweight inline
 * Gantt bar scaled to the visible date range. Intentionally simpler than
 * the per-workspace RoadmapView to avoid coupling to the workspace store.
 *
 * Lane grouping: workspace name → board name.
 */
import { useMemo } from "react";
import type { CrossWorkspaceCard } from "@/lib/queries/cards";

type Props = {
  cards: CrossWorkspaceCard[];
  viewerId: string;
};

type Lane = {
  workspaceId: string;
  workspaceName: string;
  boardId: string;
  boardTitle: string;
  cards: CrossWorkspaceCard[];
};

const PRIORITY_COLORS: Record<string, string> = {
  p0: "bg-red-500",
  p1: "bg-orange-400",
  p2: "bg-yellow-400",
  p3: "bg-blue-400",
  p4: "bg-fg/20",
};

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MeTimelineView({ cards }: Omit<Props, 'viewerId'> & { viewerId?: string }) {
  // Group into lanes: workspaceId+boardId combos.
  const lanes = useMemo<Lane[]>(() => {
    const map = new Map<string, Lane>();
    for (const c of cards) {
      const key = `${c.workspaceId}::${c.boardId}`;
      let lane = map.get(key);
      if (!lane) {
        lane = {
          workspaceId: c.workspaceId,
          workspaceName: c.workspaceName,
          boardId: c.boardId,
          boardTitle: c.boardTitle,
          cards: [],
        };
        map.set(key, lane);
      }
      lane.cards.push(c);
    }
    // Sort lanes: workspace name → board title
    return [...map.values()].sort((a, b) => {
      const ws = a.workspaceName.localeCompare(b.workspaceName);
      return ws !== 0 ? ws : a.boardTitle.localeCompare(b.boardTitle);
    });
  }, [cards]);

  // Compute global date range for proportional bar rendering.
  const { minMs, rangeMs } = useMemo(() => {
    if (cards.length === 0) {
      const now = Date.now();
      return { minMs: now, rangeMs: 30 * 86_400_000 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of cards) {
      min = Math.min(min, c.startDate.getTime());
      max = Math.max(max, c.targetDate.getTime());
    }
    const pad = (max - min) * 0.05 || 86_400_000;
    return { minMs: min - pad, rangeMs: max - min + 2 * pad };
  }, [cards]);

  if (cards.length === 0) {
    return (
      <div
        className="rounded-xl border border-hairline p-10 text-center text-fg-muted"
        data-testid="me-timeline-empty"
      >
        <p className="mono-meta">No scheduled cards</p>
        <p className="text-sm mt-1">
          Cards appear here once you set both a start date and a target date.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="me-timeline-view">
      {lanes.map((lane) => (
        <section key={`${lane.workspaceId}-${lane.boardId}`}>
          <header className="mb-3 space-y-0.5">
            <p className="mono-meta-sm text-fg-faint tracking-widest">
              {lane.workspaceName.toUpperCase()}
            </p>
            <h2 className="mono-meta text-fg">{lane.boardTitle}</h2>
          </header>

          <div className="rounded-xl border border-hairline overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[color:var(--surface-raised,rgb(0_0_0/0.15))] border-b border-hairline">
                  <th className="text-left px-3 py-2 mono-meta-sm text-fg-muted font-normal w-[40%]">
                    CARD
                  </th>
                  <th className="text-left px-3 py-2 mono-meta-sm text-fg-muted font-normal hidden sm:table-cell w-[12%]">
                    START
                  </th>
                  <th className="text-left px-3 py-2 mono-meta-sm text-fg-muted font-normal hidden sm:table-cell w-[12%]">
                    TARGET
                  </th>
                  <th className="px-3 py-2 mono-meta-sm text-fg-muted font-normal">
                    TIMELINE
                  </th>
                </tr>
              </thead>
              <tbody>
                {lane.cards.map((c) => {
                  const startPct =
                    ((c.startDate.getTime() - minMs) / rangeMs) * 100;
                  const widthPct =
                    ((c.targetDate.getTime() - c.startDate.getTime()) / rangeMs) *
                    100;
                  const barColor = c.priority
                    ? PRIORITY_COLORS[c.priority]
                    : "bg-fg/30";
                  const done = Boolean(c.completedAt);

                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-hairline last:border-0 hover:bg-[rgb(255_255_255/0.03)] transition-colors ${done ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <span
                          className={`text-fg-muted leading-snug line-clamp-1 ${done ? "line-through" : ""}`}
                        >
                          {c.title}
                        </span>
                        {c.type !== "task" && (
                          <span className="ml-1.5 mono-meta-sm text-fg-faint uppercase">
                            {c.type}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle mono-meta-sm text-fg-muted hidden sm:table-cell whitespace-nowrap">
                        {formatDate(c.startDate)}
                      </td>
                      <td className="px-3 py-2.5 align-middle mono-meta-sm text-fg-muted hidden sm:table-cell whitespace-nowrap">
                        {formatDate(c.targetDate)}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="relative h-4 w-full min-w-[80px]">
                          <div
                            className={`absolute top-1 h-2 rounded-sm ${barColor}`}
                            style={{
                              left: `${Math.max(0, startPct).toFixed(2)}%`,
                              width: `${Math.max(2, widthPct).toFixed(2)}%`,
                            }}
                            title={`${formatDate(c.startDate)} → ${formatDate(c.targetDate)}`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
