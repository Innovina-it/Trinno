"use client";
/**
 * Task 6 — Roadmap list view.
 *
 * A flat, sortable table alternative to the Gantt timeline. The same data
 * the timeline reads (cards + members + components from the workspace
 * store) drives this view, so no extra queries are needed.
 *
 * It is a TABLE, not a tree: every card is one flat row, and the whole
 * set sorts by the active column so the column reads top-to-bottom
 * monotonically. The column headers are clickable — click to sort by that
 * column, click again to flip asc/desc (default `startDate` ASC, empty
 * values last). Parent→child nesting is deliberately dropped here because
 * it breaks column sort; the anchor → task → subtask hierarchy lives on
 * the Gantt. Rows are read-only: drag-edit + inline create stay on the
 * Gantt canvas.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CornerLeftUp } from "lucide-react";
import {
  useWorkspaceStore,
  type WorkspaceState,
} from "@/stores/workspace-store";
import { PRIORITY_TINT, type CardPriority } from "@/components/board/card/priority-picker";

import { formatDate } from "@/lib/format-date";
import {
  compareCards,
  type SortDir,
  type SortKey,
} from "@/lib/roadmap/list-sort";

type StoreCard = WorkspaceState["cards"][number];

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <ArrowUpDown
        aria-hidden
        className="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-40"
      />
    );
  }
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return <Icon aria-hidden strokeWidth={2.5} className="size-3 shrink-0" />;
}

function SortHeader({
  columnKey,
  label,
  active,
  dir,
  onSort,
  align = "left",
  srLabel = false,
}: {
  columnKey: SortKey;
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right" | "center";
  srLabel?: boolean;
}) {
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      data-testid={`roadmap-list-sort-${columnKey}`}
      data-active={active ? "" : undefined}
      aria-label={`Sort by ${label.toLowerCase()}${
        active ? (dir === "asc" ? " (ascending)" : " (descending)") : ""
      }`}
      className={[
        "group/sort flex items-center gap-1 -mx-1 rounded px-1 transition-colors hover:text-fg focus-visible:text-fg focus-visible:outline-none",
        justify,
        active ? "text-fg" : "",
      ].join(" ")}
    >
      <span className={srLabel ? "sr-only" : undefined}>{label}</span>
      <SortArrow active={active} dir={dir} />
    </button>
  );
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
  depth: 0 | 1 | 2; // 0 = lane anchor, 1 = task/story/bug, 2 = subtask
  hasChildren: boolean;
};

export function RoadmapListView({
  workspaceId,
  filteredCardIds,
}: {
  workspaceId: string;
  /**
   * Id allow-list mirroring the Gantt's URL filter pipeline (type,
   * sprint, overdue, assignee, search). `null` means no filter is
   * active — every non-archived card renders.
   */
  filteredCardIds?: Set<string> | null;
}) {
  const router = useRouter();
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeProfiles = useWorkspaceStore((s) => s.workspaceProfiles);
  const storeSubBoards = useWorkspaceStore((s) => s.subBoards);

  // Active sort column + direction. Defaults to start-date ascending,
  // matching how the Gantt reads chronologically left-to-right.
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const laneAnchorIds = useMemo(
    () =>
      new Set<string>(
        storeSubBoards
          .map((sb) => sb.parentCardId)
          .filter((id): id is string => id != null),
      ),
    [storeSubBoards],
  );

  const profileById = useMemo(
    () => new Map(storeProfiles.map((p) => [p.id, p.displayName])),
    [storeProfiles],
  );

  // Flat, sortable table. Every visible card is ordered by the active
  // column, so the sorted column reads top-to-bottom monotonically (e.g.
  // START ASC = oldest start date first, across ALL rows). Parent→child
  // nesting is intentionally NOT applied here: a tree breaks column sort
  // (a child's date floats under its parent regardless of value). The
  // hierarchy lives on the Gantt; the list view is the flat table.
  const rows = useMemo<Row[]>(() => {
    const ownerNameOf = (c: StoreCard): string | null =>
      c.ownerId ? profileById.get(c.ownerId) ?? null : null;

    const visible = storeCards.filter(
      (c) =>
        !c.archived &&
        (filteredCardIds == null || filteredCardIds.has(c.id)),
    );
    return visible
      .slice()
      .sort((a, b) => compareCards(a, b, sortKey, sortDir, ownerNameOf))
      .map((card) => ({ card, depth: 0 as const, hasChildren: false }));
  }, [storeCards, filteredCardIds, profileById, sortKey, sortDir]);

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
        <SortHeader
          columnKey="title"
          label="TITLE"
          align="left"
          active={sortKey === "title"}
          dir={sortDir}
          onSort={toggleSort}
        />
        <SortHeader
          columnKey="start"
          label="START"
          align="right"
          active={sortKey === "start"}
          dir={sortDir}
          onSort={toggleSort}
        />
        <SortHeader
          columnKey="target"
          label="TARGET"
          align="right"
          active={sortKey === "target"}
          dir={sortDir}
          onSort={toggleSort}
        />
        <SortHeader
          columnKey="owner"
          label="OWNER"
          align="center"
          active={sortKey === "owner"}
          dir={sortDir}
          onSort={toggleSort}
        />
        <SortHeader
          columnKey="status"
          label="Status"
          srLabel
          align="center"
          active={sortKey === "status"}
          dir={sortDir}
          onSort={toggleSort}
        />
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map(({ card, depth }) => {
          const isLaneAnchor = laneAnchorIds.has(card.id);
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
                    isLaneAnchor ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
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
