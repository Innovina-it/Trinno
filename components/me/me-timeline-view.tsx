"use client";
/**
 * Cross-workspace timeline view for /me/timeline and /timeline.
 *
 * Workspace groups are collapsible (collapsed by default). When expanded,
 * each workspace renders its cards as the same hierarchical list view
 * used inside a single workspace's roadmap → list mode: epic → child →
 * subtask, indented, ordered by startDate ASC NULLS LAST.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CornerLeftUp } from "lucide-react";
import type { CrossWorkspaceCard } from "@/lib/queries/cards";
import { formatDate } from "@/lib/format-date";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

type Props = {
  cards: CrossWorkspaceCard[];
  viewerId: string;
  /** Workspaces the user can see, even when they have no scheduled cards.
   *  Rendered as empty collapsible sections so users know they exist. */
  allWorkspaces?: Array<{ id: string; name: string }>;
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

type Row = {
  card: CrossWorkspaceCard;
  depth: 0 | 1 | 2;
};

function timeOf(d: Date | string | null): number {
  if (!d) return Number.POSITIVE_INFINITY;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? Number.POSITIVE_INFINITY : dt.getTime();
}

function PriorityDot({ priority }: { priority: CardPriority | null }) {
  const dotClass = priority ? PRIORITY_TINT[priority].dot : "bg-fg/15";
  return (
    <span
      aria-hidden
      data-priority={priority ?? "none"}
      className={`inline-block size-2 rounded-full shrink-0 ${dotClass}`}
      title={priority ? `Priority ${priority.toUpperCase()}` : "No priority"}
    />
  );
}

// Build epic → child → subtask rows for a flat card list. Same shape as
// RoadmapListView's tree, scoped to one board's worth of cards.
function buildRows(cards: CrossWorkspaceCard[]): Row[] {
  const byParent = new Map<string | null, CrossWorkspaceCard[]>();
  const byId = new Map<string, CrossWorkspaceCard>();
  for (const c of cards) {
    byId.set(c.id, c);
    const arr = byParent.get(c.parentCardId ?? null) ?? [];
    arr.push(c);
    byParent.set(c.parentCardId ?? null, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const ta = timeOf(a.startDate);
      const tb = timeOf(b.startDate);
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });
  }
  const out: Row[] = [];
  const topLevel = byParent.get(null) ?? [];
  // Also treat as "top level" any card whose parent isn't in this slice
  // (parent lives in another workspace / board) so nothing gets dropped.
  for (const c of cards) {
    if (c.parentCardId && !byId.has(c.parentCardId)) {
      topLevel.push(c);
    }
  }
  const seenTop = new Set<string>();
  const topSorted = topLevel
    .filter((c) => {
      if (seenTop.has(c.id)) return false;
      seenTop.add(c.id);
      return true;
    })
    .sort((a, b) => {
      const ae = a.type === "epic" ? 0 : 1;
      const be = b.type === "epic" ? 0 : 1;
      if (ae !== be) return ae - be;
      const ta = timeOf(a.startDate);
      const tb = timeOf(b.startDate);
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });

  function emit(card: CrossWorkspaceCard, depth: 0 | 1 | 2) {
    out.push({ card, depth });
    const children = byParent.get(card.id) ?? [];
    for (const child of children) {
      const nextDepth: 0 | 1 | 2 = depth === 0 ? 1 : 2;
      emit(child, nextDepth);
    }
  }
  for (const c of topSorted) emit(c, 0);
  return out;
}

export function MeTimelineView({
  cards,
  allWorkspaces,
}: Omit<Props, "viewerId"> & { viewerId?: string }) {
  const router = useRouter();

  const groups = useMemo<WorkspaceGroup[]>(() => {
    const byWs = new Map<string, WorkspaceGroup>();
    // Seed empty sections for every workspace the parent claimed exists,
    // so the user can see workspaces without scheduled cards too.
    if (allWorkspaces) {
      for (const w of allWorkspaces) {
        byWs.set(w.id, {
          workspaceId: w.id,
          workspaceName: w.name,
          totalCards: 0,
          boards: [],
        });
      }
    }
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
  }, [cards, allWorkspaces]);

  const [openWs, setOpenWs] = useState<Set<string>>(() => new Set());

  function toggleWs(id: string) {
    setOpenWs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (groups.length === 0) {
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

            {open && ws.boards.length === 0 && (
              <p className="px-3 sm:px-4 py-4 text-xs text-fg-faint border-t border-hairline">
                No cards with both a start and target date yet.
              </p>
            )}
            {open && ws.boards.length > 0 && (
              <div className="space-y-4 px-3 sm:px-4 pb-4 pt-3 border-t border-hairline">
                {ws.boards.map((lane) => {
                  const rows = buildRows(lane.cards);
                  return (
                    <div key={lane.boardId}>
                      <h3 className="mono-meta text-fg mb-2">
                        {lane.boardTitle}
                      </h3>
                      <div className="rounded-lg border border-hairline overflow-hidden">
                        <div
                          className="grid items-center gap-3 border-b border-hairline bg-[color:var(--surface-strong)] px-3 py-2 mono-meta-sm text-fg-faint"
                          style={{
                            gridTemplateColumns:
                              "minmax(0,1fr) 7rem 7rem 1.5rem",
                          }}
                        >
                          <span>TITLE</span>
                          <span className="text-right tabular-nums">START</span>
                          <span className="text-right tabular-nums">
                            TARGET
                          </span>
                          <span className="sr-only">Status</span>
                        </div>
                        <ul className="divide-y divide-hairline">
                          {rows.map(({ card, depth }) => {
                            const isEpic = card.type === "epic";
                            const completed = card.completedAt != null;
                            const indentPx = depth * 20;
                            return (
                              <li
                                key={card.id}
                                data-card-id={card.id}
                                data-depth={depth}
                                data-card-type={card.type}
                                className="group/row grid items-center gap-3 px-3 py-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                                style={{
                                  gridTemplateColumns:
                                    "minmax(0,1fr) 7rem 7rem 1.5rem",
                                }}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    style={{ width: indentPx }}
                                    aria-hidden
                                  />
                                  {depth > 0 && (
                                    <CornerLeftUp
                                      aria-hidden
                                      className="size-3 text-fg-faint shrink-0 -scale-x-100"
                                    />
                                  )}
                                  <PriorityDot
                                    priority={
                                      (card.priority ?? null) as
                                        | CardPriority
                                        | null
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      router.push(
                                        `/b/${card.boardId}/c/${card.id}`,
                                      )
                                    }
                                    className={[
                                      "truncate text-left text-sm transition-colors hover:underline focus-visible:outline-none focus-visible:underline",
                                      isEpic
                                        ? "font-medium text-fg"
                                        : "text-fg-muted hover:text-fg",
                                      completed
                                        ? "line-through text-fg-faint"
                                        : "",
                                    ].join(" ")}
                                    title={card.title}
                                  >
                                    {card.title}
                                  </button>
                                  <span
                                    className="chip mono-meta-sm shrink-0 text-fg-faint"
                                    data-card-type={card.type}
                                  >
                                    {card.type.toUpperCase()}
                                  </span>
                                </div>
                                <span className="text-right text-xs text-fg-muted tabular-nums">
                                  {formatDate(card.startDate) || "—"}
                                </span>
                                <span className="text-right text-xs text-fg-muted tabular-nums">
                                  {formatDate(card.targetDate) || "—"}
                                </span>
                                <span
                                  className="flex items-center justify-center"
                                  aria-label={
                                    completed ? "Completed" : "Not completed"
                                  }
                                >
                                  {completed ? (
                                    <Check
                                      className="size-3.5 text-[color:var(--accent-lime)]"
                                      strokeWidth={3}
                                      aria-hidden
                                    />
                                  ) : (
                                    <span
                                      aria-hidden
                                      className="size-3 rounded-full border border-hairline-hi"
                                    />
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
