"use client";
/**
 * Task 6 — Roadmap list / table surface.
 *
 * A flat, sortable table alternative to the Gantt timeline. The same data
 * the timeline reads (cards + members + components from the workspace
 * store) drives this view, so no extra queries are needed.
 *
 * The rendering core is `CardTable`: a column-config-driven table. Each
 * caller passes a `columns` array (label, width, alignment, cell renderer,
 * optional sort key) plus already-built rows. `RoadmapListView` expresses
 * the historical five-column List as one such config; sibling surfaces
 * (e.g. the Deliverable view) reuse the same `CardTable` with a different
 * column set. Rows carry a `depth` so the table can render parent→child
 * nesting when a caller supplies hierarchical rows; the List config keeps
 * every row at depth 0 (flat) because nesting breaks column sort.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
} from "lucide-react";
import {
  useWorkspaceStore,
  type WorkspaceState,
} from "@/stores/workspace-store";
import { PRIORITY_TINT, type CardPriority } from "@/components/board/card/priority-picker";
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";
import { upsertCardLink, removeCardLink } from "@/actions/links";
import { setRoadmapCompletion } from "@/actions/cards";
import type { MilestoneRow } from "./milestone-dialog";

import { formatDate } from "@/lib/format-date";
import { STATUS_LABEL } from "@/lib/status";
import {
  compareCards,
  timeOf,
  type SortDir,
  type SortKey,
} from "@/lib/roadmap/list-sort";

type StoreCard = WorkspaceState["cards"][number];

/** Sortable columns of the Deliverable table. Kept local — these keys are
 *  not the List view's `SortKey` (which `compareCards` is hard-typed to). */
type DeliverableSortKey =
  | "lane"
  | "task"
  | "name"
  | "start"
  | "target"
  | "status";

/**
 * Comparator for the Deliverable table. UI-free so it stays a single source
 * of truth and is trivially testable. Lane is the default grouping axis; its
 * tiebreak reads chronologically (start date, then title) so deliverables
 * cluster under a lane in start order. Undated rows sort last in both
 * directions; every other key falls back to title for a stable, fully
 * reversible order.
 */
function compareDeliverables(
  a: StoreCard,
  b: StoreCard,
  key: DeliverableSortKey,
  dir: SortDir,
  laneOf: (c: StoreCard) => string,
  taskOf: (c: StoreCard) => string,
): number {
  const mul = dir === "asc" ? 1 : -1;
  let primary = 0;
  switch (key) {
    case "lane":
      primary = laneOf(a).localeCompare(laneOf(b));
      break;
    case "task":
      primary = taskOf(a).localeCompare(taskOf(b));
      break;
    case "name":
      primary = a.title.localeCompare(b.title);
      break;
    case "status":
      primary =
        Number(a.completedAt != null) - Number(b.completedAt != null);
      break;
    case "start":
    case "target": {
      const ta = timeOf(key === "start" ? a.startDate : a.targetDate);
      const tb = timeOf(key === "start" ? b.startDate : b.targetDate);
      const aEmpty = !Number.isFinite(ta);
      const bEmpty = !Number.isFinite(tb);
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1; // empty dates last
      primary = ta === tb ? 0 : ta < tb ? -1 : 1;
      break;
    }
  }
  if (primary === 0) {
    if (key === "lane") {
      const ta = timeOf(a.startDate);
      const tb = timeOf(b.startDate);
      primary =
        ta !== tb && Number.isFinite(ta) && Number.isFinite(tb)
          ? ta < tb
            ? -1
            : 1
          : a.title.localeCompare(b.title);
    } else {
      primary = a.title.localeCompare(b.title);
    }
  }
  return primary * mul;
}

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
  columnKey: string;
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: (k: string) => void;
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

/** Non-sortable column header — same layout box as SortHeader, no button. */
function PlainHeader({
  label,
  align = "left",
  srLabel = false,
}: {
  label: string;
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
    <span className={["flex items-center", justify].join(" ")}>
      <span className={srLabel ? "sr-only" : undefined}>{label}</span>
    </span>
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

/** Completion indicator — lime check when done, hollow ring otherwise. */
function StatusDot({ completed }: { completed: boolean }) {
  return (
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
  );
}

/**
 * Editable Open/Done control for the Deliverable table's status column.
 * Drives the roadmap completion action — Done re-files the card into the
 * board's 'done' list and stamps completed_at; Open clears completion and
 * reverts the card to the list it was in before (pre_done_list_id). The
 * optimistic patch + rollback mirrors roadmap-bar.tsx's handleToggleComplete;
 * realtime CDC reconciles the list move, so the LIST column follows. Renders
 * a read-only label for viewers/guests (the server also blocks guest writes).
 */
function OpenDoneControl({
  cardId,
  completed,
  canEdit,
}: {
  cardId: string;
  completed: boolean;
  canEdit: boolean;
}) {
  const patchCard = useWorkspaceStore((s) => s.patchCard);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span className="text-xs text-fg-muted" data-testid="deliverable-open-done">
        {completed ? "Done" : "Open"}
      </span>
    );
  }

  // Plain async await (mirrors link-section's upsertCardLink call), NOT
  // startTransition: a transition-wrapped server action fired from this
  // controlled <select>'s onChange gets aborted (ECONNRESET) when the
  // optimistic patch re-renders the row, so the write never lands.
  async function setCompleted(next: boolean) {
    if (next === completed || busy) return;
    setBusy(true);
    // Optimistic flip so the row reads immediately; CDC reconciles the
    // list move (Done → done list, Open → pre_done_list_id) shortly after.
    patchCard(cardId, { completedAt: next ? new Date() : null, dueComplete: next });
    try {
      await setRoadmapCompletion({ cardId, completed: next });
    } catch (err) {
      patchCard(cardId, { completedAt: next ? null : new Date(), dueComplete: !next });
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Open or Done"
      value={completed ? "done" : "open"}
      disabled={busy}
      onChange={(e) => setCompleted(e.target.value === "done")}
      data-testid="deliverable-open-done"
      className="rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] px-1.5 py-0.5 text-xs text-fg outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
    >
      <option value="open">Open</option>
      <option value="done">Done</option>
    </select>
  );
}

/**
 * Per-row link diamond. List view shows the diamond ONLY when a link
 * exists (no chain placeholder, per spec). Click opens the URL; long-
 * press opens the edit dialog when the viewer can edit. The wrapper
 * stops pointer/click propagation so interacting with the diamond never
 * fires the row's own open-card handler on the title button.
 */
function RowLinkIcon({ cardId }: { cardId: string }) {
  const link = useWorkspaceStore((s) => s.cardLinkByCard[cardId]);
  const setCardLink = useWorkspaceStore((s) => s.setCardLink);
  const removeCardLinkLocal = useWorkspaceStore((s) => s.removeCardLinkLocal);
  const viewerRole = useWorkspaceStore((s) => s.viewerRole);
  const canEdit = viewerRole === "owner" || viewerRole === "admin";
  const [open, setOpen] = useState(false);

  if (!link?.url) return null;

  return (
    <>
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex shrink-0"
      >
        <LinkIcon
          variant="card"
          url={link.url}
          color={link.color}
          canEdit={canEdit}
          onEdit={() => setOpen(true)}
        />
      </span>
      <LinkEditDialog
        open={open}
        onOpenChange={setOpen}
        scope="card"
        initialUrl={link.url}
        initialColor={link.color ?? DEFAULT_LINK_COLOR}
        onSave={async ({ url, color }) => {
          setCardLink({ id: link.id, cardId, url, color });
          const res = await upsertCardLink({ cardId, url, color });
          if (res.ok)
            setCardLink({
              id: res.data.id,
              cardId,
              url: res.data.url ?? url,
              color: res.data.color ?? color,
            });
          else toast.error(res.error.message);
        }}
        onRemove={async () => {
          removeCardLinkLocal(cardId);
          const res = await removeCardLink({ cardId });
          if (!res.ok) toast.error(res.error.message);
        }}
      />
    </>
  );
}

/** Row-level context handed to each column's cell renderer. */
export type CellContext = {
  depth: number;
  hasChildren: boolean;
};

/** One column in a `CardTable`. `render` returns the full grid cell node.
 *  Generic over the row item type `T` so sibling surfaces (e.g. the Milestone
 *  view) can drive the same table with non-card rows. Defaults to `StoreCard`
 *  so the existing List/Deliverable configs stay unchanged. */
export type ListColumn<T = StoreCard> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** CSS grid track for this column (e.g. "7rem" or "minmax(0,1fr)"). */
  width: string;
  /** When set the header is a sort button emitting this key; else plain. */
  sortKey?: string;
  /** Visually hide the header label (kept for screen readers). */
  srLabel?: boolean;
  render: (item: T, ctx: CellContext) => ReactNode;
};

/** A data row (one item). `card` keeps its historical name even when `T` is a
 *  non-card row, to avoid churning the existing List/Deliverable configs. */
export type CardRow<T = StoreCard> = {
  kind?: "card";
  card: T;
  /** 0 = top level. >0 indents + draws a child elbow. */
  depth: number;
  hasChildren: boolean;
};

/** A full-width section header row (e.g. a lane grouping in the Deliverable
 *  view). Spans every column and is collapsible via `onToggleGroup`. */
export type GroupRow = {
  kind: "group";
  /** Stable identity for collapse state + React key. */
  key: string;
  label: string;
  /** Count shown next to the label (e.g. "4 deliverables"). */
  count: number;
  collapsed: boolean;
};

export type TableRow<T = StoreCard> = CardRow<T> | GroupRow;

/**
 * Column-config-driven table. Header + rows are derived entirely from the
 * `columns` array, so the grid stays in lock-step across every column count.
 * Callers own data + sort state; `CardTable` is purely presentational.
 */
function CardTable<T = StoreCard>({
  columns,
  rows,
  sortKey,
  sortDir,
  onSort,
  emptyState,
  testId,
  rowTestId,
  footer,
  onToggleGroup,
  rowKey,
  rowAttrs,
}: {
  columns: ListColumn<T>[];
  rows: TableRow<T>[];
  sortKey: string;
  sortDir: SortDir;
  onSort: (k: string) => void;
  emptyState: ReactNode;
  testId: string;
  rowTestId: string;
  footer?: ReactNode;
  /** Toggles a `GroupRow`'s collapse state (only used by grouped tables). */
  onToggleGroup?: (key: string) => void;
  /** Stable React key + identity for a data row. */
  rowKey: (item: T) => string;
  /** Extra `data-*` attributes per data row (e.g. card id/type for E2E). */
  rowAttrs?: (item: T) => Record<string, string | undefined>;
}) {
  const gridTemplateColumns = columns.map((c) => c.width).join(" ");

  if (rows.length === 0) return <>{emptyState}</>;

  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-hairline overflow-hidden"
    >
      {/* Header row — sticky on tall lists so column meaning stays
          on-screen as the operator scrolls. */}
      <div
        className="sticky top-0 z-10 grid items-center gap-3 border-b border-hairline bg-[color:var(--surface-strong)] px-3 py-2 mono-meta-sm text-fg-faint"
        style={{ gridTemplateColumns }}
      >
        {columns.map((col) =>
          col.sortKey ? (
            <SortHeader
              key={col.key}
              columnKey={col.sortKey}
              label={col.label}
              align={col.align}
              srLabel={col.srLabel}
              active={sortKey === col.sortKey}
              dir={sortDir}
              onSort={onSort}
            />
          ) : (
            <PlainHeader
              key={col.key}
              label={col.label}
              align={col.align}
              srLabel={col.srLabel}
            />
          ),
        )}
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => {
          if (row.kind === "group") {
            return (
              <li
                key={`group:${row.key}`}
                data-testid={`${rowTestId}-group`}
                data-lane={row.label}
                data-collapsed={row.collapsed ? "true" : "false"}
                className="bg-[color:var(--surface)]"
              >
                <button
                  type="button"
                  onClick={() => onToggleGroup?.(row.key)}
                  className="group/grp flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[rgb(255_255_255/0.04)] focus-visible:outline-none focus-visible:bg-[rgb(255_255_255/0.04)]"
                  aria-expanded={!row.collapsed}
                >
                  {row.collapsed ? (
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 shrink-0 text-fg-faint"
                    />
                  ) : (
                    <ChevronDown
                      aria-hidden
                      className="size-3.5 shrink-0 text-fg-faint"
                    />
                  )}
                  <span className="truncate text-sm font-medium text-fg">
                    {row.label}
                  </span>
                  <span className="mono-meta-sm shrink-0 text-fg-faint">
                    {row.count}{" "}
                    {row.count === 1 ? "deliverable" : "deliverables"}
                  </span>
                </button>
              </li>
            );
          }
          const { card, depth, hasChildren } = row;
          return (
            <li
              key={rowKey(card)}
              data-testid={rowTestId}
              data-depth={depth}
              {...(rowAttrs?.(card) ?? {})}
              className="group/row grid items-center gap-3 px-3 py-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
              style={{ gridTemplateColumns }}
            >
              {columns.map((col) => (
                <Fragment key={col.key}>
                  {col.render(card, { depth, hasChildren })}
                </Fragment>
              ))}
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
}

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
  const rows = useMemo<TableRow[]>(() => {
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
      .map((card) => ({ card, depth: 0, hasChildren: false }));
  }, [storeCards, filteredCardIds, profileById, sortKey, sortDir]);

  const columns = useMemo<ListColumn[]>(
    () => [
      {
        key: "title",
        label: "TITLE",
        align: "left",
        width: "minmax(0,1fr)",
        sortKey: "title",
        render: (card, { depth }) => {
          const isLaneAnchor = laneAnchorIds.has(card.id);
          const completed = card.completedAt != null;
          const indentPx = depth * 20;
          return (
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
              <RowLinkIcon cardId={card.id} />
              {/* Type chip — surfaces what kind of card this row is so
                  the depth indent reads unambiguously. */}
              <span
                className="chip mono-meta-sm shrink-0 text-fg-faint"
                data-card-type={card.type}
              >
                {card.type.toUpperCase()}
              </span>
            </div>
          );
        },
      },
      {
        key: "start",
        label: "START",
        align: "right",
        width: "7rem",
        sortKey: "start",
        render: (card) => (
          <span className="text-right text-xs text-fg-muted tabular-nums">
            {formatDate(card.startDate) || "—"}
          </span>
        ),
      },
      {
        key: "target",
        label: "TARGET",
        align: "right",
        width: "7rem",
        sortKey: "target",
        render: (card) => (
          <span className="text-right text-xs text-fg-muted tabular-nums">
            {formatDate(card.targetDate) || "—"}
          </span>
        ),
      },
      {
        key: "owner",
        label: "OWNER",
        align: "center",
        width: "2rem",
        sortKey: "owner",
        render: (card) => (
          <span className="flex items-center justify-center">
            <OwnerAvatar
              displayName={
                card.ownerId ? profileById.get(card.ownerId) ?? null : null
              }
            />
          </span>
        ),
      },
      {
        key: "status",
        label: "Status",
        align: "center",
        width: "1.5rem",
        sortKey: "status",
        srLabel: true,
        render: (card) => <StatusDot completed={card.completedAt != null} />,
      },
    ],
    [router, laneAnchorIds, profileById],
  );

  return (
    <CardTable
      columns={columns}
      rows={rows}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={(k) => toggleSort(k as SortKey)}
      rowKey={(c) => c.id}
      rowAttrs={(c) => ({ "data-card-id": c.id, "data-card-type": c.type })}
      testId="roadmap-list-view"
      rowTestId="roadmap-list-row"
      emptyState={
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
      }
      footer={
        /* Reserve workspaceId so deep-links can attach future filters
           (e.g. focus a specific card via `?focus=…`). */
        <span hidden data-workspace-id={workspaceId} />
      }
    />
  );
}

/**
 * Deliverable table — sibling of the List view built on the same `CardTable`.
 *
 * A "deliverable" is a non-archived card that carries a URL link (the colored
 * link diamond). Columns: Lane / Task (parent) / Deliverable name / Link /
 * Status / Start / End. Clicking the deliverable name opens the in-place quick
 * edit (via `onOpenCard`) rather than navigating to the full card route, which
 * is the one behavioural difference from the List view's title cell.
 */
export function RoadmapDeliverableView({
  workspaceId,
  filteredCardIds,
  onOpenCard,
}: {
  workspaceId: string;
  /** Same URL-filter allow-list the Gantt/List use. `null` = no filter. */
  filteredCardIds?: Set<string> | null;
  /** Opens the in-place card quick-edit popup (set by the roadmap view). */
  onOpenCard: (cardId: string, boardId: string) => void;
}) {
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeBoards = useWorkspaceStore((s) => s.boards);
  const storeSubBoards = useWorkspaceStore((s) => s.subBoards);
  const storeLists = useWorkspaceStore((s) => s.lists);
  const cardLinkByCard = useWorkspaceStore((s) => s.cardLinkByCard);
  const viewerRole = useWorkspaceStore((s) => s.viewerRole);
  const canEdit = viewerRole === "owner" || viewerRole === "admin";

  // Within-lane ordering. Default start-date ascending so deliverables read
  // chronologically under each lane. Lanes themselves always sort by name.
  const [sortKey, setSortKey] = useState<DeliverableSortKey>("start");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleSort(key: string) {
    const k = key as DeliverableSortKey;
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  function toggleLane(lane: string) {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }

  // card id → lane (sub-board) name. Mirrors `groupBySubBoard`: a card sits in
  // a sub-board lane when its home board IS that sub-board; the sub-board's
  // anchor card is labelled with its own lane; everything else falls back to
  // the card's board title. Unlike the Gantt grouping this also resolves
  // subtasks (matched by their boardId), so a linked subtask still gets a lane.
  const laneNameByCardId = useMemo(() => {
    const anchorIdToTitle = new Map<string, string>();
    const subBoardIdToTitle = new Map<string, string>();
    for (const sb of storeSubBoards) {
      if (sb.parentCardId) anchorIdToTitle.set(sb.parentCardId, sb.title);
      subBoardIdToTitle.set(sb.id, sb.title);
    }
    const boardTitleById = new Map(storeBoards.map((b) => [b.id, b.title]));
    const out = new Map<string, string>();
    for (const c of storeCards) {
      out.set(
        c.id,
        anchorIdToTitle.get(c.id) ??
          subBoardIdToTitle.get(c.boardId) ??
          boardTitleById.get(c.boardId) ??
          "Uncategorized",
      );
    }
    return out;
  }, [storeCards, storeBoards, storeSubBoards]);

  const titleById = useMemo(
    () => new Map(storeCards.map((c) => [c.id, c.title])),
    [storeCards],
  );

  // card list → roadmap status-kind lookup, for the read-only "LIST" column.
  // Mirrors getCardStatusKind: the value is the statusKind of the list the
  // card currently sits in (null when that list is unmapped).
  const statusKindByListId = useMemo(
    () => new Map(storeLists.map((l) => [l.id, l.statusKind])),
    [storeLists],
  );

  // Rows = non-archived link-bearing cards, grouped into collapsible lane
  // sections. Each lane emits a header row followed (unless collapsed) by its
  // deliverables, ordered within the lane by the active column.
  const rows = useMemo<TableRow[]>(() => {
    const laneOf = (c: StoreCard) => laneNameByCardId.get(c.id) ?? "";
    const taskOf = (c: StoreCard) =>
      c.parentCardId ? titleById.get(c.parentCardId) ?? "" : "";
    const visible = storeCards.filter(
      (c) =>
        !c.archived &&
        Boolean(cardLinkByCard[c.id]?.url) &&
        (filteredCardIds == null || filteredCardIds.has(c.id)),
    );

    const byLane = new Map<string, StoreCard[]>();
    for (const c of visible) {
      const lane = laneNameByCardId.get(c.id) ?? "Uncategorized";
      const arr = byLane.get(lane) ?? [];
      arr.push(c);
      byLane.set(lane, arr);
    }

    const out: TableRow[] = [];
    for (const lane of [...byLane.keys()].sort((a, b) => a.localeCompare(b))) {
      const laneCards = byLane
        .get(lane)!
        .slice()
        .sort((a, b) =>
          compareDeliverables(a, b, sortKey, sortDir, laneOf, taskOf),
        );
      const collapsed = collapsedLanes.has(lane);
      out.push({
        kind: "group",
        key: lane,
        label: lane,
        count: laneCards.length,
        collapsed,
      });
      if (!collapsed) {
        for (const card of laneCards) {
          out.push({ kind: "card", card, depth: 1, hasChildren: false });
        }
      }
    }
    return out;
  }, [
    storeCards,
    cardLinkByCard,
    filteredCardIds,
    laneNameByCardId,
    titleById,
    sortKey,
    sortDir,
    collapsedLanes,
  ]);

  const columns = useMemo<ListColumn[]>(
    () => [
      {
        key: "name",
        label: "DELIVERABLE",
        align: "left",
        width: "minmax(0,1fr)",
        sortKey: "name",
        render: (card, { depth }) => {
          const completed = card.completedAt != null;
          const parent = card.parentCardId
            ? titleById.get(card.parentCardId) ?? null
            : null;
          return (
            <div
              className="flex items-center gap-2 min-w-0"
              style={{ paddingLeft: depth * 16 }}
            >
              <PriorityDot priority={card.priority ?? null} />
              {parent && (
                <span
                  className="shrink-0 truncate max-w-[8rem] text-xs text-fg-faint"
                  title={parent}
                >
                  {parent} ›
                </span>
              )}
              <button
                type="button"
                onClick={() => onOpenCard(card.id, card.boardId)}
                className={[
                  "truncate text-left text-sm transition-colors hover:underline focus-visible:outline-none focus-visible:underline",
                  completed
                    ? "line-through text-fg-faint"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
                title={card.title}
                data-card-id={card.id}
                data-testid="roadmap-deliverable-name"
              >
                {card.title}
              </button>
              {/* The colored link diamond rides with the name — it IS the
                  deliverable's link, so it reads as one unit. */}
              <RowLinkIcon cardId={card.id} />
            </div>
          );
        },
      },
      {
        key: "status",
        label: "Open/Done",
        align: "left",
        width: "7rem",
        sortKey: "status",
        render: (card) => (
          <OpenDoneControl
            cardId={card.id}
            completed={card.completedAt != null}
            canEdit={canEdit}
          />
        ),
      },
      {
        // Read-only "LIST" column — the name of the list the card sits in,
        // expressed as its roadmap status kind (to do / in progress / review
        // / done / blocked). Derived from store data; "—" when unmapped.
        key: "list",
        label: "LIST",
        align: "left",
        width: "7rem",
        render: (card) => {
          const kind = statusKindByListId.get(card.listId) ?? null;
          return (
            <span className="text-xs text-fg-muted">
              {kind ? STATUS_LABEL[kind] : "—"}
            </span>
          );
        },
      },
      {
        key: "start",
        label: "START",
        align: "right",
        width: "7rem",
        sortKey: "start",
        render: (card) => (
          <span className="text-right text-xs text-fg-muted tabular-nums">
            {formatDate(card.startDate) || "—"}
          </span>
        ),
      },
      {
        key: "target",
        label: "END",
        align: "right",
        width: "7rem",
        sortKey: "target",
        render: (card) => (
          <span className="text-right text-xs text-fg-muted tabular-nums">
            {formatDate(card.targetDate) || "—"}
          </span>
        ),
      },
    ],
    [titleById, onOpenCard, statusKindByListId, canEdit],
  );

  return (
    <CardTable
      columns={columns}
      rows={rows}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={toggleSort}
      onToggleGroup={toggleLane}
      rowKey={(c) => c.id}
      rowAttrs={(c) => ({ "data-card-id": c.id, "data-card-type": c.type })}
      testId="roadmap-deliverable-view"
      rowTestId="roadmap-deliverable-row"
      emptyState={
        <div
          className="relative min-h-[40vh] grid place-items-center text-center"
          data-testid="roadmap-deliverable-empty"
        >
          <div className="space-y-3 max-w-md">
            <p className="serif-display text-4xl">No deliverables yet.</p>
            <p className="text-sm text-fg-muted">
              A deliverable is a task with a link attached. Add a link to a
              task on the board, then come back here to see it listed.
            </p>
          </div>
        </div>
      }
      footer={<span hidden data-workspace-id={workspaceId} />}
    />
  );
}

/** Sortable columns of the Milestone table. */
type MilestoneSortKey = "name" | "date";

/**
 * Comparator for the Milestone table. UI-free, single source of truth, and
 * trivially testable. Date is the default axis so milestones read
 * chronologically; undated rows (should not occur — date is required) sort
 * last in both directions. Name is the tiebreak for a stable, fully reversible
 * order.
 */
function compareMilestones(
  a: MilestoneRow,
  b: MilestoneRow,
  key: MilestoneSortKey,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  let primary = 0;
  if (key === "date") {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    const aEmpty = !Number.isFinite(ta);
    const bEmpty = !Number.isFinite(tb);
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1; // empty dates last
    primary = ta === tb ? 0 : ta < tb ? -1 : 1;
  } else {
    primary = a.name.localeCompare(b.name);
  }
  if (primary === 0) primary = a.name.localeCompare(b.name);
  return primary * mul;
}

/**
 * Milestone table — sibling of the List/Deliverable views built on the same
 * generic `CardTable`. Columns: Milestone (name) / Date / Color. Clicking the
 * name fires `onEdit`, which the roadmap view wires to the existing milestone
 * edit dialog. Milestones already live client-side (fetched by the roadmap
 * view), so this view takes them as a prop rather than re-querying.
 */
export function RoadmapMilestoneView({
  workspaceId,
  milestones,
  onEdit,
}: {
  workspaceId: string;
  milestones: MilestoneRow[];
  /** Opens the milestone edit dialog (set by the roadmap view). */
  onEdit: (milestone: MilestoneRow) => void;
}) {
  // Default date-ascending so milestones read chronologically, mirroring how
  // the Gantt orders left-to-right.
  const [sortKey, setSortKey] = useState<MilestoneSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: string) {
    const k = key as MilestoneSortKey;
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const columns = useMemo<ListColumn<MilestoneRow>[]>(
    () => [
      {
        key: "name",
        label: "MILESTONE",
        align: "left",
        width: "minmax(0,1fr)",
        sortKey: "name",
        render: (m) => (
          <button
            type="button"
            onClick={() => onEdit(m)}
            className="flex items-center gap-2 min-w-0 truncate text-left text-sm text-fg-muted transition-colors hover:text-fg hover:underline focus-visible:outline-none focus-visible:underline"
            title={m.name}
            data-milestone-id={m.id}
            data-testid="roadmap-milestone-name"
          >
            {m.icon ? (
              <span aria-hidden className="shrink-0">
                {m.icon}
              </span>
            ) : null}
            <span className="truncate">{m.name}</span>
          </button>
        ),
      },
      {
        key: "date",
        label: "DATE",
        align: "right",
        width: "9rem",
        sortKey: "date",
        render: (m) => (
          <span className="text-right text-xs text-fg-muted tabular-nums">
            {formatDate(m.date) || "—"}
          </span>
        ),
      },
      {
        key: "color",
        label: "COLOR",
        align: "center",
        width: "5rem",
        render: (m) => (
          <span className="flex items-center justify-center">
            <span
              aria-hidden
              data-testid="roadmap-milestone-color"
              data-color={m.color}
              className="inline-block size-3.5 rounded-full border border-hairline"
              style={{ backgroundColor: m.color }}
            />
            <span className="sr-only">{m.color}</span>
          </span>
        ),
      },
    ],
    [onEdit],
  );

  const rows = useMemo<TableRow<MilestoneRow>[]>(
    () =>
      milestones
        .slice()
        .sort((a, b) => compareMilestones(a, b, sortKey, sortDir))
        .map((m) => ({
          kind: "card" as const,
          card: m,
          depth: 0,
          hasChildren: false,
        })),
    [milestones, sortKey, sortDir],
  );

  return (
    <CardTable<MilestoneRow>
      columns={columns}
      rows={rows}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={toggleSort}
      rowKey={(m) => m.id}
      rowAttrs={(m) => ({ "data-milestone-id": m.id })}
      testId="roadmap-milestone-view"
      rowTestId="roadmap-milestone-row"
      emptyState={
        <div
          className="relative min-h-[40vh] grid place-items-center text-center"
          data-testid="roadmap-milestone-empty"
        >
          <div className="space-y-3 max-w-md">
            <p className="serif-display text-4xl">No milestones yet.</p>
            <p className="text-sm text-fg-muted">
              Add a milestone from the roadmap toolbar, then come back here to
              see them listed by date.
            </p>
          </div>
        </div>
      }
      footer={<span hidden data-workspace-id={workspaceId} />}
    />
  );
}

// Shared building blocks re-exported so sibling table surfaces (e.g. the
// Deliverable view) can compose the same cells without re-implementing them.
export {
  CardTable,
  SortHeader,
  PlainHeader,
  PriorityDot,
  OwnerAvatar,
  StatusDot,
  RowLinkIcon,
};
