"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CornerLeftUp, CalendarRange, CircleDot, Layers3 } from "lucide-react";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getCardStatusKind, STATUS_LABEL } from "@/lib/roadmap/status";
import { LabelStripes } from "./card/label-stripes";
import { DuePill } from "./card/due-pill";
import { TileIndicators } from "./card/tile-indicators";
import { TypeIcon } from "./card/type-picker";
import { BlockedBadge } from "./card/blocked-badge";
import { StoryPointsChip } from "./card/story-points-chip";
import { TimeChip } from "./card/time-chip";
import { PriorityChip, type CardPriority } from "./card/priority-picker";
import { CardCover } from "./card/cover-picker";
import { cardCode } from "@/lib/format";

function fmtShortDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CardTile({
  card,
  boardId,
  workspaceId,
}: {
  card: CardRow;
  boardId: string;
  workspaceId?: string;
}) {
  const router = useRouter();
  const sortableId = `card:${card.id}`;
  const parentCard = useBoardStore((s) =>
    card.parentCardId ? s.cards.find((c) => c.id === card.parentCardId) : null,
  );
  // Plan #16b-γ-Gantt-B (B2) — pull sprint name from workspace store so the
  // tile shows the human-readable sprint name instead of a literal "IN SPRINT"
  // tag. Selector returns a primitive (string | null) to keep zustand
  // referential stability and avoid re-render thrash.
  const sprintName = useWorkspaceStore((s) =>
    card.sprintId
      ? (s.sprints.find((sp) => sp.id === card.sprintId)?.name ?? null)
      : null,
  );
  // Plan #16b-γ-Gantt-B (B3) — derive the card's status from the workspace
  // store's `lists`. Selector returns a primitive (StatusKind | null) so
  // zustand referential stability holds. When null (list unmapped or absent
  // during a CDC race) the badge isn't rendered.
  const statusKind = useWorkspaceStore((s) =>
    getCardStatusKind({ listId: card.listId }, s.lists),
  );
  // Plan #16b-γ-D (#8) — multi-select state.
  const isSelected = useBoardStore((s) => s.selectedCardIds.has(card.id));
  const anySelected = useBoardStore((s) => s.selectedCardIds.size > 0);
  const toggleSelected = useBoardStore((s) => s.toggleSelected);
  const selectRangeTo = useBoardStore((s) => s.selectRangeTo);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: sortableId,
      data: { type: "card", cardId: card.id, listId: card.listId },
    });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging
      ? "0 0 0 1px rgb(255 255 255 / 0.55), 0 24px 50px -12px rgb(0 0 0 / 0.7), 0 0 0 4px rgb(255 255 255 / 0.10)"
      : undefined,
    // Lift dragged tile above siblings so it's never visually buried.
    zIndex: isDragging ? 50 : undefined,
  };

  // Suppress Link navigation if a drag actually occurred (browser still fires
  // click after a tiny move below the activation threshold otherwise).
  // Plan #16b-γ-D (#8) — also intercept shift/cmd/ctrl-click for
  // multi-select. While any card is selected, plain click also goes to
  // toggle so the user doesn't need to drag the cursor to the modifier
  // key just to grow the selection. Hitting Esc or clicking the bulk
  // bar's Cancel button clears the selection.
  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      selectRangeTo(card.id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelected(card.id);
      return;
    }
    if (anySelected) {
      // Toggle this tile into/out of the selection rather than navigate.
      e.preventDefault();
      e.stopPropagation();
      toggleSelected(card.id);
      return;
    }
  };

  return (
    <Link
      ref={setNodeRef}
      href={`/b/${boardId}/c/${card.id}`}
      scroll={false}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      data-card-id={card.id}
      data-dragging={isDragging ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      className="group/card relative block rounded-xl bg-[color:var(--surface-strong)] backdrop-blur-md border border-[color:var(--hairline)] text-fg cursor-grab transition-all duration-200 ease-out shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset,0_8px_20px_-12px_rgb(0_0_0_/_0.5)] hover:-translate-y-0.5 hover:border-[color:var(--hairline-hi)] hover:bg-[color:var(--surface-hi)] hover:shadow-[0_1px_0_0_rgb(255_255_255/0.10)_inset,0_12px_28px_-12px_rgb(0_0_0/0.6)] active:cursor-grabbing data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02] data-[dragging=true]:cursor-grabbing data-[selected=true]:ring-2 data-[selected=true]:ring-[color:var(--accent-cyan)] data-[selected=true]:bg-[color:var(--surface-hi)]"
    >
      {/* Cover (color stripe or image header) — sits above label stripes */}
      <CardCover
        coverKind={(card.coverKind ?? "none") as "none" | "color" | "image"}
        coverValue={card.coverValue ?? null}
      />

      {/* Label stripes — top */}
      <LabelStripes cardId={card.id} />

      {/* Top metadata row: type icon + card ID via pseudo-element */}
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-1.5">
          <TypeIcon type={card.type ?? "task"} className="size-3 text-fg-faint" />
          <BlockedBadge cardId={card.id} />
          {card.priority && (
            <PriorityChip priority={card.priority as CardPriority} />
          )}
          <StoryPointsChip cardId={card.id} />
          <TimeChip cardId={card.id} />
        </div>
        <span
          aria-hidden
          className="card-code-stamp leading-none"
          data-card-code={cardCode(card.id)}
        />
      </div>

      {/* Title — Geist sans, gradient underline grows on hover */}
      <div className="px-3 pb-2.5 pt-1">
        <span className="block text-sm leading-snug">
          <span className="hover-underline-signal group-hover/card:hover-underline-signal-active inline">
            {card.title}
          </span>
        </span>
        {card.parentCardId && (
          <span
            className="mt-1 inline-flex items-center gap-1 mono-meta-sm text-fg-faint max-w-full"
            data-testid="tile-parent-breadcrumb"
            title={parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
          >
            <CornerLeftUp className="size-3 shrink-0" />
            <span className="truncate max-w-[8rem]">
              {parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
            </span>
          </span>
        )}
      </div>

      {card.dueDate && (
        <div className="px-3 pb-2.5">
          <DuePill card={card} />
        </div>
      )}

      {(card.startDate || card.targetDate) && workspaceId && (
        <div className="px-3 pb-2.5">
          <button
            type="button"
            data-testid="tile-schedule"
            onClick={(e) => {
              // Don't open the card route — go to roadmap instead.
              e.preventDefault();
              e.stopPropagation();
              router.push(`/w/${workspaceId}/roadmap?focus=${card.id}`);
            }}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
            title="View on roadmap"
          >
            <CalendarRange className="size-3" />
            {card.startDate ? fmtShortDate(card.startDate) : "?"}
            {" → "}
            {card.targetDate ? fmtShortDate(card.targetDate) : "?"}
          </button>
        </div>
      )}

      {(card.sprintId || statusKind) && (
        <div className="px-3 pb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {card.sprintId && (
              <span
                data-testid="tile-sprint"
                data-sprint-id={card.sprintId}
                title={sprintName ? `Sprint: ${sprintName}` : `Sprint ${card.sprintId}`}
                className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
              >
                <Layers3 className="size-3" />
                {sprintName ?? "IN SPRINT"}
              </span>
            )}
            {statusKind && (
              <span
                data-testid="tile-status"
                data-status-kind={statusKind}
                title={`Status: ${STATUS_LABEL[statusKind]}`}
                className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
              >
                <CircleDot className="size-3" />
                {STATUS_LABEL[statusKind].toUpperCase()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="px-3 pb-2.5">
        <TileIndicators cardId={card.id} />
      </div>
    </Link>
  );
}
