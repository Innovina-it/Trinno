"use client";
/**
 * Cross-workspace timeline view for /me/timeline and /timeline.
 *
 * Renders cards grouped by workspace (collapsible, collapsed by default)
 * → board with a lightweight inline Gantt bar scaled to the visible date
 * range. Intentionally simpler than the per-workspace RoadmapView to
 * avoid coupling to the workspace store.
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CrossWorkspaceCard } from "@/lib/queries/cards";
import { formatDate } from "@/lib/format-date";

type Props = {
  cards: CrossWorkspaceCard[];
  viewerId: string;
};

type BoardLane = {
  boardId: string;
  boardTitle: string;
  cards: CrossWorkspaceCard[];
};

type WorkspaceGroup = {
  workspaceId: string;
  workspaceName: string;
  totalCards: number;
  boards: BoardLane[];
};

const PRIORITY_COLORS: Record<string, string> = {
  p0: "bg-red-500",
  p1: "bg-orange-400",
  p2: "bg-yellow-400",
  p3: "bg-blue-400",
  p4: "bg-fg/20",
};

export function MeTimelineView({
  cards,
}: Omit<Props, "viewerId"> & { viewerId?: string }) {
  // Group: workspace → boards → cards. Sorted by name throughout.
  const groups = useMemo<WorkspaceGroup[]>(() => {
    const byWs = new Map<string, WorkspaceGroup>();
    for (const c of cards) {
      let ws = byWs.get(c.workspaceId);
      if (!ws) {
        ws = {
          workspaceId: c.workspaceId,
          workspaceName: c.workspaceName,
          totalCards: 0,
          boards: [],
        };
        byWs.set(c.workspaceId, ws);
      }
      let board = ws.boards.find((b) => b.boardId === c.boardId);
      if (!board) {
        board = { boardId: c.boardId, boardTitle: c.boardTitle, cards: [] };
        ws.boards.push(board);
      }
      board.cards.push(c);
      ws.totalCards += 1;
    }
    const out = [...byWs.values()];
    for (const ws of out) {
      ws.boards.sort((a, b) => a.boardTitle.localeCompare(b.boardTitle));
    }
    out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
    return out;
  }, [cards]);

  // Collapse state: keep only the OPEN workspace ids in the set. Default
  // is empty → every workspace collapsed on first paint.
  const [openWs, setOpenWs] = useState<Set<string>>(() => new Set());

  function toggleWs(id: string) {
    setOpenWs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Global date range for proportional bar rendering.
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
    <div className="space-y-3" data-testid="me-timeline-view">
      {groups.map((ws) => {
        const open = openWs.has(ws.workspaceId);
        const boardCount = ws.boards.length;
        return (
          <section
            key={ws.workspaceId}
            data-testid={`me-timeline-ws-${ws.workspaceId}`}
            data-open={open ? "true" : undefined}
            className="rounded-xl border border-hairline overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleWs(ws.workspaceId)}
              aria-expanded={open}
              className="w-full flex items-center gap-2 px-3 sm:px-4 py-2.5 text-left bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.04)]"
            >
              <ChevronRight
                className={`size-3.5 text-fg-faint transition-transform ${open ? "rotate-90" : ""}`}
                aria-hidden
              />
              <span className="mono-meta-sm text-fg-faint tracking-widest">
                {ws.workspaceName.toUpperCase()}
              </span>
              <span className="ml-auto mono-meta-sm text-fg-muted tabular-nums">
                {boardCount} {boardCount === 1 ? "BOARD" : "BOARDS"} ·{" "}
                {ws.totalCards} {ws.totalCards === 1 ? "CARD" : "CARDS"}
              </span>
            </button>

            {open && (
              <div className="space-y-4 px-3 sm:px-4 pb-4 pt-3 border-t border-hairline">
                {ws.boards.map((lane) => (
                  <div key={lane.boardId}>
                    <h3 className="mono-meta text-fg mb-2">{lane.boardTitle}</h3>
                    <div className="rounded-lg border border-hairline overflow-hidden">
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
                              ((c.targetDate.getTime() -
                                c.startDate.getTime()) /
                                rangeMs) *
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
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
