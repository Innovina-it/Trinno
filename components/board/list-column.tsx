"use client";
import { useMemo, useState, useTransition } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, Trash2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import type { ListRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { archiveList, deleteList } from "@/actions/lists";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { undoBus } from "@/lib/undo-bus";
import { errorBus } from "@/lib/errors/error-bus";
import { CardTile } from "./card-tile";
import { AddCardForm } from "./add-card-form";
import { roman } from "@/lib/format";

// Plan #16b-γ-C (#3) — opt-in virtualization. We render at most this
// many tiles up front; cards beyond fold behind a "Show all (+N)" chip
// the user toggles to expand. Full windowed virtualization is deferred
// to a later pass.
const VIRTUALIZE_THRESHOLD = 100;

// Per-list accent — deterministic from list id, monochrome shades.
const ACCENT_PALETTE = [
  "rgb(250 250 250 / 0.85)",
  "rgb(250 250 250 / 0.55)",
  "rgb(250 250 250 / 0.35)",
  "rgb(250 250 250 / 0.70)",
  "rgb(250 250 250 / 0.45)",
];

// Semantic status colors — the only chromatic exception in the
// monochrome theme. When a list has a status_kind set in Settings, its
// accent strip and WIP chip pick up the workflow color so state is
// visible without opening the card.
const STATUS_ACCENT: Record<string, string> = {
  todo:        "var(--status-todo)",
  in_progress: "var(--status-in-progress)",
  review:      "var(--status-review)",
  done:        "var(--status-done)",
  blocked:     "var(--status-blocked)",
};

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function ListColumn({
  list,
  boardId,
  workspaceId,
  ordinal,
  cardIdFilter,
}: {
  list: ListRow;
  boardId: string;
  workspaceId?: string;
  ordinal?: number;
  cardIdFilter?: Set<string>;
}) {
  const cards = useBoardStore((s) => s.cards);
  const listCards = useMemo(
    () => cards.filter((c) => c.listId === list.id),
    [cards, list.id],
  );
  const filtered = useMemo(
    () => (cardIdFilter ? listCards.filter((c) => cardIdFilter.has(c.id)) : listCards),
    [listCards, cardIdFilter],
  );

  // Cap rendered tiles at VIRTUALIZE_THRESHOLD until the user opts in.
  const [showAll, setShowAll] = useState(false);
  const overflowing = filtered.length > VIRTUALIZE_THRESHOLD && !showAll;
  const visibleCards = overflowing
    ? filtered.slice(0, VIRTUALIZE_THRESHOLD)
    : filtered;
  const hiddenCount = filtered.length - visibleCards.length;

  const sortableId = `list:${list.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: sortableId,
      data: { type: "list", listId: list.id },
    });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `list-drop:${list.id}`,
    data: { type: "list-drop", listId: list.id },
  });

  const statusAccent = list.statusKind ? STATUS_ACCENT[list.statusKind] : undefined;
  const accent =
    statusAccent ?? ACCENT_PALETTE[hashId(list.id) % ACCENT_PALETTE.length];

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.6 : 1,
  };

  const cardSortableIds = useMemo(
    () => visibleCards.map((c) => `card:${c.id}`),
    [visibleCards],
  );

  const numeral = ordinal ? roman(ordinal) : "—";
  const cardLabel = `${filtered.length} CARD${filtered.length === 1 ? "" : "S"}`;
  const listMeta = `${numeral} · ${cardLabel}`;
  const overLimit = list.wipLimit != null && filtered.length > list.wipLimit;

  // Plan #16b-γ-D (#10) — archive list with undo. The store removes the
  // list (and its cards) optimistically via the realtime subscription.
  // The undo callback restores via archiveList(id, archived=false).
  const updateListLocal = useBoardStore((s) => s.updateList);
  const removeListLocal = useBoardStore((s) => s.removeList);
  const [, startArchive] = useTransition();
  const [, startDelete] = useTransition();
  function onDelete() {
    if (
      !window.confirm(
        `Delete list "${list.title}" PERMANENTLY? All cards in it will also be deleted. Cannot be undone.`,
      )
    )
      return;
    startDelete(async () => {
      try {
        await deleteList({ id: list.id });
        removeListLocal(list.id);
        toast.success(`Deleted list "${list.title}"`);
      } catch (err) {
        const m = (err as Error).message;
        toast.error(`Delete failed: ${m}`);
        errorBus.push({ message: `Delete list failed: ${m}` });
      }
    });
  }
  function onArchive() {
    if (
      !window.confirm(
        `Archive list "${list.title}"? Cards stay attached and you can restore from settings.`,
      )
    )
      return;
    startArchive(async () => {
      try {
        await archiveList({ id: list.id, archived: true });
        undoBus.push({
          message: `Archived list "${list.title}"`,
          undo: async () => {
            try {
              await archiveList({ id: list.id, archived: false });
              updateListLocal(list.id, { archived: false });
            } catch (err) {
              const m = "Failed to undo: " + (err as Error).message;
              toast.error(m);
              errorBus.push({ message: m });
            }
          },
        });
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Archive list failed: ${m}` });
      }
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-list-id={list.id}
      data-dragging={isDragging ? "true" : undefined}
      className="group/list relative flex w-80 shrink-0 flex-col rounded-2xl glass overflow-hidden transition-all duration-300 ease-out data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02]"
    >
      {/* Per-list accent strip — vertical bar on the left edge, fades top-to-bottom.
          Status-coloured lists get a thicker strip + soft glow so the workflow
          color reads at a glance; monochrome lists stay subtle. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0"
        style={{
          width: statusAccent ? "3px" : "2px",
          background: `linear-gradient(180deg, ${accent} 0%, transparent 100%)`,
          boxShadow: statusAccent
            ? `0 0 12px ${statusAccent}, 0 0 4px ${statusAccent}`
            : undefined,
        }}
      />

      {/* Column heading: ordinal+count meta in chip, serif italic title */}
      <div className="relative border-b border-hairline px-4 py-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab select-none active:cursor-grabbing"
        >
          <div className="flex items-baseline gap-2">
            <span
              aria-hidden
              className="list-ordinal-stamp block leading-none"
              data-list-ordinal={listMeta}
            />
            <span
              data-testid="list-wip-chip"
              className={`chip tabular-nums ${overLimit ? "bg-red-900/40 text-red-200 ring-1 ring-red-500/30" : ""}`}
              style={
                statusAccent && !overLimit
                  ? {
                      boxShadow: `inset 0 0 0 1px ${statusAccent}`,
                      color: statusAccent,
                    }
                  : undefined
              }
            >
              {filtered.length}{list.wipLimit != null ? `/${list.wipLimit}` : ""}
            </span>
          </div>
          <h3
            className="serif-display text-2xl text-fg mt-1.5 leading-tight transition-all duration-200 group-hover/list:gradient-text-static"
            style={{ ['--accent' as string]: accent } as React.CSSProperties}
          >
            {list.title}
          </h3>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="absolute right-2 top-2 rounded p-1.5 text-fg-muted hover:bg-[rgb(255_255_255/0.06)] hover:text-fg transition-colors"
            aria-label="List actions"
            data-testid="list-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              data-testid="list-archive"
              onClick={() => onArchive()}
            >
              <Archive className="size-3.5" />
              <span>Archive list</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid="list-delete"
              onClick={() => onDelete()}
            >
              <Trash2 className="size-3.5" />
              <span>Delete permanently</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={setDropRef}
        data-over={isOver ? "true" : undefined}
        className="flex max-h-[calc(100vh-22rem)] flex-col gap-2.5 overflow-y-auto p-2.5 transition-colors duration-200 data-[over=true]:bg-[color:var(--surface-strong)]"
      >
        <SortableContext
          items={cardSortableIds}
          strategy={verticalListSortingStrategy}
        >
          {visibleCards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              boardId={boardId}
              workspaceId={workspaceId}
            />
          ))}
        </SortableContext>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            data-testid="list-show-all"
            className="chip mono-meta-sm self-center inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
          >
            SHOW ALL · +{hiddenCount} MORE
          </button>
        )}
      </div>
      <div className="border-t border-hairline px-2.5 py-2">
        <AddCardForm listId={list.id} />
      </div>
    </div>
  );
}
