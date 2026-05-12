"use client";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleDot, ListTodo, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TypeIcon } from "./card/type-picker";
import { PriorityChip, type CardPriority } from "./card/priority-picker";

// Plan: Quick card view on double-click. Read-only summary surfaced from
// the board store; the only mutating action is "Open advanced settings"
// which navigates to the full card modal route. Mirrors the clinical,
// dense kanban aesthetic — tinted neutrals, no decorative gradients.
//
// Refactor: this component is now store-agnostic — it accepts already-
// resolved card data + member profiles via props. The board surface
// (card-tile.tsx) and the roadmap surface (roadmap-view.tsx) each
// compute the props from their own zustand store. This keeps the
// component reusable across parent layouts where the parallel-route
// modal intercept does NOT cross (e.g. /w/[workspaceId]/roadmap ↔
// /b/[boardId]/c/[cardId]).

const DESCRIPTION_MAX = 240;

export type QuickViewProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type QuickViewCard = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | string | null;
  dueComplete: boolean;
  completedAt: Date | string | null;
  type: string | null;
  priority: string | null;
  startDate: Date | string | null;
  targetDate: Date | string | null;
};

function fmtShortDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CardQuickView({
  card,
  memberProfiles,
  subtaskTotal,
  subtaskDone,
  boardId,
  open,
  onOpenChange,
}: {
  card: QuickViewCard | null;
  memberProfiles: QuickViewProfile[];
  subtaskTotal: number;
  subtaskDone: number;
  boardId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();

  if (!card) {
    // Defensive: card was removed between the tile rendering and the
    // dialog opening. Render an empty dialog content so the parent can
    // dismiss it cleanly.
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="card-quick-view-missing">
          <DialogHeader>
            <DialogTitle>Card unavailable</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const completed = card.completedAt != null || card.dueComplete;
  const desc = card.description ?? "";
  const descPreview =
    desc.length > DESCRIPTION_MAX
      ? desc.slice(0, DESCRIPTION_MAX).trimEnd() + "…"
      : desc;

  function openAdvanced() {
    onOpenChange(false);
    router.push(`/b/${boardId}/c/${card!.id}`, { scroll: false });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="card-quick-view" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle
            data-testid="card-quick-view-title"
            className={completed ? "line-through text-fg-muted" : ""}
          >
            {card.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* TYPE row — mirrors the new-card pill row, one slot active. */}
          <div className="space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">TYPE</span>
            <div className="grid grid-cols-4 gap-1.5" aria-label="Card type">
              {(["task", "story", "bug", "epic"] as const).map((t) => {
                const selected = (card.type ?? "task") === t;
                return (
                  <span
                    key={t}
                    data-selected={selected ? "true" : undefined}
                    data-testid={
                      selected ? "card-quick-view-type" : undefined
                    }
                    className={[
                      "inline-flex items-center justify-center gap-1.5",
                      "rounded-full border border-hairline px-2.5 py-1.5",
                      "mono-meta-sm",
                      selected
                        ? "bg-[rgb(255_255_255/0.10)] ring-1 ring-fg/40 border-transparent text-fg"
                        : "text-fg-faint",
                    ].join(" ")}
                  >
                    <TypeIcon type={t} className="size-3.5" />
                    <span>{t.toUpperCase()}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* PRIORITY + STATUS — two-column row, always rendered. */}
          <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <span className="mono-meta-sm text-fg-faint">PRIORITY</span>
                <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2">
                  {card.priority ? (
                    <PriorityChip priority={card.priority as CardPriority} />
                  ) : (
                    <span className="mono-meta-sm text-fg-faint">—</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <span className="mono-meta-sm text-fg-faint">STATUS</span>
                <div
                  data-testid="card-quick-view-completion"
                  data-completed={completed ? "true" : "false"}
                  className="flex h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2"
                >
                  <CircleDot
                    className={
                      "size-3 " +
                      (completed
                        ? "text-[color:var(--accent-lime)]"
                        : "text-fg-faint")
                    }
                    aria-hidden
                  />
                  <span
                    className={
                      "mono-meta-sm " +
                      (completed ? "text-fg" : "text-fg-muted")
                    }
                  >
                    {completed ? "DONE" : "OPEN"}
                  </span>
                </div>
              </div>
            </div>

          {/* START / TARGET — two-column date row, parallels new-card dialog. */}
          {(card.startDate || card.targetDate) && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <span className="mono-meta-sm text-fg-faint">START</span>
                <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.startDate ? fmtShortDate(card.startDate) : "—"}
                </div>
              </div>
              <div className="space-y-1">
                <span className="mono-meta-sm text-fg-faint">TARGET</span>
                <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.targetDate ? fmtShortDate(card.targetDate) : "—"}
                </div>
              </div>
            </div>
          )}

          {/* DUE — single row, only when set (separate concept from start/target). */}
          {card.dueDate && (
            <div className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">DUE</span>
              <div
                data-testid="card-quick-view-due"
                className="flex h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2"
              >
                <CalendarClock
                  className="size-3 text-fg-faint"
                  aria-hidden
                />
                <span className="text-fg tabular-nums">
                  {fmtShortDate(card.dueDate)}
                </span>
              </div>
            </div>
          )}

          {/* ASSIGNEES — chip row matching new-card-dialog aesthetic. */}
          <div
            className="space-y-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
            data-testid="card-quick-view-assignees"
          >
            <div className="flex items-center gap-1.5">
              <Users className="size-3 text-fg-faint" aria-hidden />
              <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
              {memberProfiles.length > 0 && (
                <span className="mono-meta-sm text-fg-muted tabular-nums">
                  ({memberProfiles.length})
                </span>
              )}
            </div>
            {memberProfiles.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {memberProfiles.map((p) => (
                  <li key={p.id}>
                    <span
                      data-user-id={p.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-transparent px-1.5 py-0.5 text-[10px] text-fg-muted"
                    >
                      <Avatar
                        size="sm"
                        className="rounded-none border border-current size-4"
                      >
                        <AvatarFallback className="rounded-none bg-transparent text-current text-[9px] tracking-widest">
                          {p.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="normal-case tracking-normal">
                        {p.displayName}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mono-meta-sm text-fg-faint">Unassigned</p>
            )}
          </div>

          {/* SUBTASKS — one-row summary. */}
          {subtaskTotal > 0 && (
            <div className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">SUBTASKS</span>
              <div
                data-testid="card-quick-view-subtasks"
                className="flex h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2"
              >
                <ListTodo className="size-3 text-fg-faint" aria-hidden />
                <span className="text-fg tabular-nums">
                  {subtaskDone}/{subtaskTotal}
                </span>
              </div>
            </div>
          )}

          {/* DESCRIPTION — only when populated. */}
          {descPreview && (
            <div className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">DESCRIPTION</span>
              <div
                data-testid="card-quick-view-description"
                className="rounded-md border border-hairline bg-transparent px-2 py-1.5"
              >
                <p className="text-xs leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
                  {descPreview}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="card-quick-view-close"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={openAdvanced}
            data-testid="card-quick-view-open-advanced"
          >
            Open advanced settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

