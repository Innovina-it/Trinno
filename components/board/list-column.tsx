"use client";
import { useMemo, useState, useTransition } from "react";
import { useShallow } from "zustand/shallow";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, Trash2, MoreVertical, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import type { ListRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { archiveList, deleteList, setListColor } from "@/actions/lists";
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
import { NewCardDialog } from "./new-card-dialog";

// Plan #16b-γ-C (#3) — opt-in virtualization. We render at most this
// many tiles up front; cards beyond fold behind a "Show all (+N)" chip
// the user toggles to expand. Full windowed virtualization is deferred
// to a later pass.
const VIRTUALIZE_THRESHOLD = 100;

// Status colors: the only chromatic exception in the monochrome theme.
// When a list maps to a workflow state, its strip + WIP chip take that
// state's color. Lists without a state get a single neutral hairline
// strip; we no longer randomize per-list shades, which gave the false
// impression of meaning where there was none.
const STATUS_ACCENT: Record<string, string> = {
  todo:        "var(--status-todo)",
  in_progress: "var(--status-in-progress)",
  review:      "var(--status-review)",
  done:        "var(--status-done)",
  blocked:     "var(--status-blocked)",
};
const NEUTRAL_ACCENT = "var(--hairline-hi)";

// Optional per-list custom color, set via the column "…" menu. Wins over
// the status-derived accent when present. Keys are persisted to
// `lists.color` and validated by `ListColorZ`.
type ListColorKey = "slate" | "amber" | "sky" | "emerald" | "rose" | "violet";
const COLOR_PALETTE: { key: ListColorKey; label: string; rgb: string }[] = [
  { key: "slate",   label: "Slate",   rgb: "rgb(148 163 184)" },
  { key: "amber",   label: "Amber",   rgb: "rgb(245 158 11)" },
  { key: "sky",     label: "Sky",     rgb: "rgb(56 189 248)" },
  { key: "emerald", label: "Emerald", rgb: "rgb(34 197 94)" },
  { key: "rose",    label: "Rose",    rgb: "rgb(251 113 133)" },
  { key: "violet",  label: "Violet",  rgb: "rgb(167 139 250)" },
];
const COLOR_RGB: Record<ListColorKey, string> = Object.fromEntries(
  COLOR_PALETTE.map((c) => [c.key, c.rgb]),
) as Record<ListColorKey, string>;

export function ListColumn({
  list,
  boardId,
  workspaceId,
  cardIdFilter,
}: {
  list: ListRow;
  boardId: string;
  workspaceId?: string;
  ordinal?: number;
  cardIdFilter?: Set<string>;
}) {
  // Per-list selector. Previously this read `s.cards` whole and filtered
  // in a useMemo — every single-card update bumped the array reference
  // and every column on the board re-rendered. `useShallow` makes the
  // hook compare item refs so re-renders only fire when *this* list's
  // cards actually change.
  const listCards = useBoardStore(
    useShallow((s) => s.cards.filter((c) => c.listId === list.id)),
  );
  const filtered = useMemo(
    () => (cardIdFilter ? listCards.filter((c) => cardIdFilter.has(c.id)) : listCards),
    [listCards, cardIdFilter],
  );

  // Cap rendered tiles at VIRTUALIZE_THRESHOLD until the user opts in.
  const [showAll, setShowAll] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
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

  const customColor = list.color
    ? COLOR_RGB[list.color as ListColorKey]
    : undefined;
  const statusAccent = list.statusKind ? STATUS_ACCENT[list.statusKind] : undefined;
  // Custom color > status mapping > neutral hairline.
  const accent = customColor ?? statusAccent ?? NEUTRAL_ACCENT;
  const accentIsExplicit = Boolean(customColor || statusAccent);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.6 : 1,
  };

  const cardSortableIds = useMemo(
    () => visibleCards.map((c) => `card:${c.id}`),
    [visibleCards],
  );

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
  const [, startColor] = useTransition();
  function onSetColor(next: ListColorKey | null) {
    const prev = (list.color ?? null) as ListColorKey | null;
    if (prev === next) return;
    updateListLocal(list.id, { color: next });
    startColor(async () => {
      try {
        await setListColor({ id: list.id, color: next });
      } catch (err) {
        updateListLocal(list.id, { color: prev });
        const m = (err as Error).message;
        toast.error(`Color update failed: ${m}`);
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
      className="group/list relative flex w-[85vw] max-w-[320px] sm:w-80 shrink-0 snap-start flex-col rounded-2xl glass overflow-hidden transition-all duration-300 ease-out data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02]"
    >
      {/* Per-list accent strip — vertical bar on the left edge, fades top-to-bottom.
          Status-coloured lists get a thicker strip + soft glow so the workflow
          color reads at a glance; monochrome lists stay subtle. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0"
        style={{
          width: accentIsExplicit ? "3px" : "2px",
          background: `linear-gradient(180deg, ${accent} 0%, transparent 100%)`,
        }}
      />

      {/* Column heading: title row, then a quiet meta line (count + WIP). */}
      <div className="relative border-b border-hairline px-4 py-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab select-none active:cursor-grabbing"
        >
          <h3
            className="font-sans text-base font-semibold tracking-tight text-fg leading-tight pr-8 truncate"
            style={{ ['--accent' as string]: accent } as React.CSSProperties}
          >
            {list.title}
          </h3>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              data-testid="list-wip-chip"
              className="chip tabular-nums"
              style={
                overLimit
                  ? {
                      color: "var(--status-blocked)",
                      boxShadow:
                        "inset 0 0 0 1px color-mix(in oklab, var(--status-blocked) 50%, transparent)",
                    }
                  : accentIsExplicit
                    ? {
                        boxShadow: `inset 0 0 0 1px ${accent}`,
                        color: accent,
                      }
                    : undefined
              }
            >
              {filtered.length}{list.wipLimit != null ? `/${list.wipLimit}` : ""}
            </span>
            {overLimit && (
              <span className="mono-meta-sm" style={{ color: "var(--status-blocked)" }}>
                OVER
              </span>
            )}
          </div>
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
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <div className="mono-meta-sm text-fg-faint mb-1.5">COLOR</div>
              <div className="flex items-center gap-1.5">
                {COLOR_PALETTE.map((c) => {
                  const active = list.color === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-label={c.label}
                      aria-pressed={active}
                      onClick={() => onSetColor(c.key)}
                      className="relative size-5 rounded-full border border-hairline-hi transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                      style={{ background: c.rgb }}
                    >
                      {active && (
                        <Check
                          className="absolute inset-0 m-auto size-3 text-[color:var(--bg-deep)]"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-label="Reset color"
                  aria-pressed={!list.color}
                  onClick={() => onSetColor(null)}
                  className="relative size-5 rounded-full border border-hairline-hi bg-[color:var(--surface)] text-fg-muted transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  title="Reset to status color"
                >
                  <span className="absolute inset-0 m-auto block size-3 rounded-full border border-hairline-hi" />
                </button>
              </div>
            </div>
            <DropdownMenuSeparator />
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
        {visibleCards.length === 0 && filtered.length === 0 && (
          <div
            className="self-stretch text-center py-3 mono-meta-sm text-fg-faint select-none"
            data-testid="list-empty"
          >
            NO CARDS
          </div>
        )}
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
        <button
          type="button"
          onClick={() => setAddCardOpen(true)}
          data-testid="list-add-card"
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-hairline bg-transparent px-2 py-1.5 mono-meta-sm text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)]"
        >
          <Plus className="size-3.5" aria-hidden />
          Add card
        </button>
      </div>
      <NewCardDialog
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        defaultBoard={boardId}
        defaultList={list.id}
      />
    </div>
  );
}
