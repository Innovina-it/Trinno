"use client";
import { useState, useTransition, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useShallow } from "zustand/shallow";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, Check, CircleDot, CornerLeftUp, Layers3 } from "lucide-react";
import { toast } from "sonner";
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
import { CompleteToggle } from "./card/complete-toggle";
import { cardCode } from "@/lib/format";
import { updateCard } from "@/actions/cards";
import { SubtaskBadge } from "./card-tile-subtask-badge";
import { CardQuickView } from "./card-quick-view";

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
  const updateCardLocal = useBoardStore((s) => s.updateCard);

  // Quick-view data — previously selected inside CardQuickView itself.
  // Lifted here so the component is store-agnostic and can be reused
  // from the roadmap (which reads useWorkspaceStore instead).
  // Array selectors MUST use useShallow to avoid Zustand's
  // "getSnapshot should be cached" snapshot-loop bug.
  const quickViewMemberIds = useBoardStore(
    useShallow((s) =>
      s.cardMembers.filter((m) => m.cardId === card.id).map((m) => m.userId),
    ),
  );
  const quickViewProfiles = useBoardStore(
    useShallow((s) =>
      s.boardProfiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      })),
    ),
  );
  // Two primitive scalar selectors — returning {total, done} as one object
  // would trip Zustand's snapshot warning. See CardMetaRow / SubtaskBadge
  // for the same pattern.
  const quickViewSubtaskTotal = useBoardStore((s) => {
    let n = 0;
    for (const c of s.cards) {
      if (c.parentCardId === card.id && !c.archived) n += 1;
    }
    return n;
  });
  const quickViewSubtaskDone = useBoardStore((s) => {
    let n = 0;
    for (const c of s.cards) {
      if (c.parentCardId === card.id && !c.archived && c.completedAt != null) {
        n += 1;
      }
    }
    return n;
  });

  // Inline title edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(card.title);
  // Quick-view dialog state. Independent of inline title editing so the
  // title's onDoubleClick (enterEdit) keeps working — the title stops
  // propagation, so the tile's onDoubleClick won't double-trigger.
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [, startTransition] = useTransition();
  // Track whether blur should be ignored after a keyboard-commit/cancel.
  const commitRef = useRef(false);

  const enterEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(card.title);
    setIsEditing(true);
  }, [card.title]);

  const cancelEdit = useCallback(() => {
    commitRef.current = true;
    setIsEditing(false);
    setEditValue(card.title);
  }, [card.title]);

  const saveEdit = useCallback(() => {
    commitRef.current = true;
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error("Title can't be empty");
      setIsEditing(false);
      setEditValue(card.title);
      return;
    }
    if (trimmed === card.title) {
      setIsEditing(false);
      return;
    }
    const prev = card.title;
    setIsEditing(false);
    updateCardLocal(card.id, { title: trimmed });
    startTransition(async () => {
      try {
        await updateCard({ id: card.id, title: trimmed });
      } catch (err) {
        updateCardLocal(card.id, { title: prev });
        setEditValue(prev);
        toast.error((err as Error).message ?? "Failed to save title");
      }
    });
  }, [editValue, card.title, card.id, updateCardLocal]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit],
  );

  const handleEditBlur = useCallback(() => {
    if (commitRef.current) {
      commitRef.current = false;
      return;
    }
    saveEdit();
  }, [saveEdit]);

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
    // Soft client-side navigation — avoids Next.js hard-nav from <Link>.
    router.push(`/b/${boardId}/c/${card.id}`, { scroll: false });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(`/b/${boardId}/c/${card.id}`, { scroll: false });
    }
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSelected(card.id);
  };

  const completed = card.completedAt != null || card.dueComplete;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isEditing ? {} : listeners)}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Suppress while dragging or in multi-select mode — both modes
        // already own primary click handling.
        if (isDragging || anySelected) return;
        setQuickViewOpen(true);
      }}
      onKeyDown={handleKeyDown}
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

      {/* Title row. The round completion control lives beside the title;
          the square bulk-select handle stays up top so their meanings
          remain visually distinct. */}
      <div className="flex items-start gap-2 px-3 pb-1 pt-1.5">
        <CompleteToggle
          cardId={card.id}
          completed={completed}
          size="sm"
          className="mt-0.5"
          onLocalChange={(next) =>
            updateCardLocal(card.id, {
              completedAt: next ? new Date() : null,
              dueComplete: next,
            })
          }
        />
        <span
          data-testid="tile-title"
          data-completed={completed ? "true" : "false"}
          className={`block min-w-0 flex-1 text-sm leading-snug font-medium ${
            completed ? "line-through text-fg-muted" : ""
          }`}
        >
          {isEditing ? (
            <input
              data-testid="tile-title-edit"
              type="text"
              value={editValue}
              maxLength={120}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={handleEditBlur}
              className={`w-full bg-transparent border-0 outline-none ring-0 p-0 m-0 text-sm leading-snug font-medium focus:underline decoration-fg/40 ${
                completed ? "line-through text-fg-muted" : ""
              }`}
              style={{ fontFamily: "inherit" }}
            />
          ) : (
            <span
              className="hover-underline-signal group-hover/card:hover-underline-signal-active inline"
              onDoubleClick={enterEdit}
            >
              {card.title}
            </span>
          )}
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
      {/* Quick view dialog — portaled, so position inside the tile doesn't
          affect layout. Opened by double-click on the tile body. Card data
          + member profiles + subtask counts are computed above from
          useBoardStore and passed as props (component is store-agnostic). */}
      <CardQuickView
        card={{
          id: card.id,
          title: card.title,
          description: card.description,
          dueDate: card.dueDate,
          dueComplete: card.dueComplete,
          completedAt: card.completedAt,
          type: card.type,
          priority: card.priority,
        }}
        memberProfiles={quickViewMemberIds
          .map((id) => quickViewProfiles.find((p) => p.id === id))
          .filter(
            (p): p is { id: string; displayName: string; avatarUrl: string | null } =>
              !!p,
          )}
        subtaskTotal={quickViewSubtaskTotal}
        subtaskDone={quickViewSubtaskDone}
        boardId={boardId}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
      />
    </div>
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
  // Two primitive selectors instead of one returning a new {total, completed}
  // object — the latter triggered Zustand's "getSnapshot should be cached"
  // warning and an infinite re-render loop because every selector run
  // produced a fresh object reference.
  // Subtask progress is now handled by SubtaskBadge (card-tile-subtask-badge.tsx).

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
      <SubtaskBadge cardId={card.id} />
      <TileIndicators cardId={card.id} />
    </div>
  );
}
