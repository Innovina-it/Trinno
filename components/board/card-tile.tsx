"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, Check, CircleDot, CornerLeftUp, Layers3 } from "lucide-react";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getCardStatusKind, STATUS_LABEL } from "@/lib/status";
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
  const sp = useSearchParams();
  // Status chip duplicates the list strip's color when the column itself is
  // mapped to a status. Only meaningful when swimlanes detach the card from
  // its column visual context (any laneMode != "none").
  const laneMode = sp.get("lanes") ?? "none";
  const showStatus = laneMode !== "none";

  const sortableId = `card:${card.id}`;
  const parentCard = useBoardStore((s) =>
    card.parentCardId ? s.cards.find((c) => c.id === card.parentCardId) : null,
  );
  const sprintName = useWorkspaceStore((s) =>
    card.sprintId
      ? (s.sprints.find((sp) => sp.id === card.sprintId)?.name ?? null)
      : null,
  );
  const statusKind = useWorkspaceStore((s) =>
    getCardStatusKind({ listId: card.listId }, s.lists),
  );
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
    zIndex: isDragging ? 50 : undefined,
  };

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
      e.preventDefault();
      e.stopPropagation();
      toggleSelected(card.id);
      return;
    }
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSelected(card.id);
  };

  const completed = card.completedAt != null;

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
      <CardCover
        coverKind={(card.coverKind ?? "none") as "none" | "color" | "image"}
        coverValue={card.coverValue ?? null}
      />
      <LabelStripes cardId={card.id} />

      {/* Header: type + (optional) parent breadcrumb on left, cardCode + select-handle on right. */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <TypeIcon
            type={card.type ?? "task"}
            className="size-3 shrink-0 text-fg-faint"
          />
          {card.parentCardId && (
            <span
              data-testid="tile-parent-breadcrumb"
              title={parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
              className="inline-flex items-center gap-1 mono-meta-sm text-fg-faint min-w-0"
            >
              <CornerLeftUp className="size-3 shrink-0" aria-hidden />
              <span className="truncate max-w-[7rem]">
                {parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            aria-hidden
            className="card-code-stamp leading-none"
            data-card-code={cardCode(card.id)}
          />
          {/* Bulk-select handle (top-right).  Square — distinct from the
              round complete dot.  Hover-visible at rest; persists when
              selection mode is active.  Cyan accent when selected so it
              never collides with the neutral white complete fill. */}
          <button
            type="button"
            onClick={handleSelectClick}
            data-testid="tile-select-handle"
            aria-label={isSelected ? "Deselect card" : "Select card"}
            aria-pressed={isSelected}
            className={`size-5 rounded-[4px] border-[1.5px] flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
              isSelected
                ? "bg-[color:var(--accent-cyan)] border-[color:var(--accent-cyan)] text-[color:var(--bg-deep)]"
                : anySelected
                  ? "border-hairline-hi text-fg-muted hover:border-fg/60"
                  : "border-hairline text-transparent opacity-0 group-hover/card:opacity-100 hover:border-hairline-hi"
            }`}
          >
            {isSelected && <Check className="size-3.5" strokeWidth={3} />}
          </button>
        </div>
      </div>

      {/* Title row.  Inline complete-toggle is gone — it collided with
          the bulk-select handle.  Completion is reached via the card
          modal's due section.  Done-state shows as line-through +
          muted ink so the visual signal is preserved. */}
      <div className="px-3 pb-1 pt-1.5">
        <span
          data-testid="tile-title"
          data-completed={completed ? "true" : "false"}
          className={`block text-sm leading-snug font-medium ${
            completed ? "line-through text-fg-muted" : ""
          }`}
        >
          <span className="hover-underline-signal group-hover/card:hover-underline-signal-active inline">
            {card.title}
          </span>
        </span>
      </div>

      {/* Single meta row. Wraps when needed. */}
      <CardMetaRow
        card={card}
        statusKind={statusKind}
        sprintName={sprintName}
        showStatus={showStatus}
        workspaceId={workspaceId}
        onSchedClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (workspaceId) {
            router.push(`/w/${workspaceId}/roadmap?focus=${card.id}`);
          }
        }}
        fmtShortDate={fmtShortDate}
      />
    </Link>
  );
}

function CardMetaRow({
  card,
  statusKind,
  sprintName,
  showStatus,
  workspaceId,
  onSchedClick,
  fmtShortDate,
}: {
  card: CardRow;
  statusKind: ReturnType<typeof getCardStatusKind>;
  sprintName: string | null;
  showStatus: boolean;
  workspaceId?: string;
  onSchedClick: (e: React.MouseEvent) => void;
  fmtShortDate: (d: Date | string) => string;
}) {
  const hasSched = (card.startDate || card.targetDate) && workspaceId;
  const hasSprint = !!card.sprintId;
  const hasStatus = showStatus && !!statusKind;
  const hasDue = !!card.dueDate;
  const hasPriority = !!card.priority;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1">
      <BlockedBadge cardId={card.id} />
      {hasPriority && (
        <PriorityChip priority={card.priority as CardPriority} />
      )}
      {hasDue && <DuePill card={card} />}
      {hasSched && (
        <button
          type="button"
          data-testid="tile-schedule"
          onClick={onSchedClick}
          className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
          title="View on roadmap"
        >
          <CalendarRange className="size-3" aria-hidden />
          {card.startDate ? fmtShortDate(card.startDate) : "?"}
          {" → "}
          {card.targetDate ? fmtShortDate(card.targetDate) : "?"}
        </button>
      )}
      {hasSprint && (
        <span
          data-testid="tile-sprint"
          data-sprint-id={card.sprintId}
          title={sprintName ? `Sprint: ${sprintName}` : `Sprint ${card.sprintId}`}
          className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
        >
          <Layers3 className="size-3" aria-hidden />
          <span className="truncate max-w-[6rem]">
            {sprintName ?? "IN SPRINT"}
          </span>
        </span>
      )}
      {hasStatus && (
        <span
          data-testid="tile-status"
          data-status-kind={statusKind}
          title={`Status: ${STATUS_LABEL[statusKind!]}`}
          className="chip mono-meta-sm inline-flex items-center gap-1"
          style={{
            color: `var(--status-${statusKind!.replace("_", "-")})`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--status-${statusKind!.replace("_", "-")}) 50%, transparent)`,
          }}
        >
          <CircleDot className="size-3" aria-hidden />
          {STATUS_LABEL[statusKind!].toUpperCase()}
        </span>
      )}
      <StoryPointsChip cardId={card.id} />
      <TimeChip cardId={card.id} />
      <TileIndicators cardId={card.id} />
    </div>
  );
}
