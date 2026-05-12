"use client";
/**
 * Task 6 — Roadmap list view.
 *
 * A flat, hierarchical alternative to the Gantt timeline. The same data
 * the timeline reads (cards + members + components from the workspace
 * store) drives this view, so no extra queries are needed. The list is
 * organized as:
 *
 *   epic → task/story/bug → subtask
 *
 * within each lane the parent rows render in `startDate` ASC order
 * (NULLS LAST). Subtasks live nested under their parent and follow the
 * same ordering. The component is intentionally read-only: the goal is a
 * scannable, ordered overview — drag-edit + inline create still live on
 * the Gantt canvas.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Check, CornerLeftUp } from "lucide-react";
import {
  useWorkspaceStore,
  type WorkspaceState,
} from "@/stores/workspace-store";
import { PRIORITY_TINT, type CardPriority } from "@/components/board/card/priority-picker";

import { formatDate } from "@/lib/format-date";

type StoreCard = WorkspaceState["cards"][number];

function timeOf(d: Date | string | null): number {
  if (!d) return Number.POSITIVE_INFINITY; // NULLS LAST in ASC sort
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? Number.POSITIVE_INFINITY : dt.getTime();
}

function PriorityDot({ priority }: { priority: CardPriority | null }) {
  const dotClass = priority
    ? PRIORITY_TINT[priority].dot
    : "bg-fg/15";
  return (
    <span
      aria-hidden
      data-priority={priority ?? "none"}
      className={`inline-block size-2 rounded-full shrink-0 ${dotClass}`}
      title={priority ? `Priority ${priority.toUpperCase()}` : "No priority"}
    />
  );
}

function OwnerAvatar({
  displayName,
  size = 5,
}: {
  displayName: string | null;
  size?: number;
}) {
  if (!displayName) return null;
  return (
    <Avatar
      size="sm"
      className={`rounded-none border border-hairline-hi size-${size}`}
      title={displayName}
    >
      <AvatarFallback className="rounded-none bg-transparent text-fg-muted text-[9px] tracking-widest">
        {displayName.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

type Row = {
  card: StoreCard;
  depth: 0 | 1 | 2; // 0 = epic, 1 = task/story/bug, 2 = subtask
  hasChildren: boolean;
};

export function RoadmapListView({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const router = useRouter();
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeProfiles = useWorkspaceStore((s) => s.workspaceProfiles);

  const profileById = useMemo(
    () => new Map(storeProfiles.map((p) => [p.id, p.displayName])),
    [storeProfiles],
  );

  // Build the tree. Cards already live in a flat list, so we group by
  // parent and walk a depth-first traversal that emits one row per card
  // in startDate-ASC order at every level.
  const rows = useMemo<Row[]>(() => {
    const visible = storeCards.filter((c) => !c.archived);
    const byParent = new Map<string | null, StoreCard[]>();
    const byId = new Map<string, StoreCard>();
    for (const c of visible) {
      byId.set(c.id, c);
      const arr = byParent.get(c.parentCardId ?? null) ?? [];
      arr.push(c);
      byParent.set(c.parentCardId ?? null, arr);
    }
    // Sort each bucket once by startDate ASC, NULLS LAST, then title.
    for (const arr of byParent.values()) {
      arr.sort((a, b) => {
        const ta = timeOf(a.startDate);
        const tb = timeOf(b.startDate);
        if (ta !== tb) return ta - tb;
        return a.title.localeCompare(b.title);
      });
    }
    const out: Row[] = [];
    // Top-level entry points: epics first, then any other top-level card
    // (story/task/bug) that lacks a parent. Epics get their own root row
    // so the hierarchy reads epic → child → subtask top-down.
    const topLevel = byParent.get(null) ?? [];
    const epicsFirst = topLevel.slice().sort((a, b) => {
      const ae = a.type === "epic" ? 0 : 1;
      const be = b.type === "epic" ? 0 : 1;
      if (ae !== be) return ae - be;
      const ta = timeOf(a.startDate);
      const tb = timeOf(b.startDate);
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });

    function emit(card: StoreCard, depth: 0 | 1 | 2) {
      const children = byParent.get(card.id) ?? [];
      out.push({ card, depth, hasChildren: children.length > 0 });
      for (const child of children) {
        // Depth caps at 2 (subtask). Anything deeper is rare but we keep
        // it at 2 so layout doesn't degrade — the tree shape itself still
        // reflects the parent chain via order, even when extra nesting
        // exists in the data.
        const nextDepth: 0 | 1 | 2 =
          depth === 0 ? 1 : depth === 1 ? 2 : 2;
        emit(child, nextDepth);
      }
    }
    for (const top of epicsFirst) emit(top, top.type === "epic" ? 0 : 1);
    return out;
  }, [storeCards]);

  // Owner-display lookup pulled from the workspace profiles array.
  function ownerName(card: StoreCard): string | null {
    if (!card.ownerId) return null;
    return profileById.get(card.ownerId) ?? null;
  }

  if (rows.length === 0) {
    return (
      <div
        className="relative min-h-[40vh] grid place-items-center text-center"
        data-testid="roadmap-list-empty"
      >
        <div className="space-y-3 max-w-md">
          <p className="serif-display text-4xl">No cards yet.</p>
          <p className="text-sm text-fg-muted">
            Create your first card on the board, then come back here to
            see it ordered by start date.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="roadmap-list-view"
      className="rounded-xl border border-hairline overflow-hidden"
    >
      {/* Header row — sticky on tall lists so column meaning stays
          on-screen as the operator scrolls. */}
      <div
        className="sticky top-0 z-10 grid items-center gap-3 border-b border-hairline bg-[color:var(--surface-strong)] px-3 py-2 mono-meta-sm text-fg-faint"
        style={{ gridTemplateColumns: "minmax(0,1fr) 7rem 7rem 2rem 1.5rem" }}
      >
        <span>TITLE</span>
        <span className="text-right tabular-nums">START</span>
        <span className="text-right tabular-nums">TARGET</span>
        <span className="text-center">OWNER</span>
        <span className="sr-only">Status</span>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map(({ card, depth }) => {
          const isEpic = card.type === "epic";
          const completed = card.completedAt != null;
          const indentPx = depth * 20;
          const owner = ownerName(card);
          return (
            <li
              key={card.id}
              data-testid="roadmap-list-row"
              data-card-id={card.id}
              data-depth={depth}
              data-card-type={card.type}
              className="group/row grid items-center gap-3 px-3 py-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
              style={{ gridTemplateColumns: "minmax(0,1fr) 7rem 7rem 2rem 1.5rem" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span style={{ width: indentPx }} aria-hidden />
                {depth > 0 && (
                  <CornerLeftUp
                    aria-hidden
                    className="size-3 text-fg-faint shrink-0 -scale-x-100"
                  />
                )}
                <PriorityDot priority={card.priority ?? null} />
                <button
                  type="button"
                  onClick={() => router.push(`/b/${card.boardId}/c/${card.id}`)}
                  className={[
                    "truncate text-left text-sm transition-colors hover:underline focus-visible:outline-none focus-visible:underline",
                    isEpic ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                    completed ? "line-through text-fg-faint" : "",
                  ].join(" ")}
                  title={card.title}
                  data-card-id={card.id}
                  data-testid="roadmap-list-title"
                >
                  {card.title}
                </button>
                {/* Type chip — surfaces what kind of card this row is so
                    the depth indent reads unambiguously. */}
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
              <span className="flex items-center justify-center">
                <OwnerAvatar displayName={owner} />
              </span>
              <span
                className="flex items-center justify-center"
                aria-label={completed ? "Completed" : "Not completed"}
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
      {/* Reserve workspaceId so deep-links can attach future filters
          (e.g. focus a specific card via `?focus=…`). */}
      <span hidden data-workspace-id={workspaceId} />
    </div>
  );
}
