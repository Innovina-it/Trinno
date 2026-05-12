"use client";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleDot, ListTodo } from "lucide-react";
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
      <DialogContent data-testid="card-quick-view" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle
            data-testid="card-quick-view-title"
            className={completed ? "line-through text-fg-muted" : ""}
          >
            {card.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Type + priority + completion dot. All read-only. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {card.type && card.type !== "task" && (
              <span
                data-testid="card-quick-view-type"
                className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
              >
                <TypeIcon type={card.type} className="size-3" />
                {card.type.toUpperCase()}
              </span>
            )}
            {card.priority && (
              <span data-testid="card-quick-view-priority">
                <PriorityChip priority={card.priority as CardPriority} />
              </span>
            )}
            <span
              data-testid="card-quick-view-completion"
              data-completed={completed ? "true" : "false"}
              className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
              title={completed ? "Completed" : "Not completed"}
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
              {completed ? "DONE" : "OPEN"}
            </span>
          </div>

          {/* Assignees — small read-only avatar chips. */}
          {memberProfiles.length > 0 && (
            <div
              className="space-y-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
              data-testid="card-quick-view-assignees"
            >
              <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
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
            </div>
          )}

          {/* Due date — single line, omitted entirely when null. */}
          {card.dueDate && (
            <div
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
              data-testid="card-quick-view-due"
            >
              <CalendarClock className="size-3 text-fg-faint" aria-hidden />
              <span className="mono-meta-sm text-fg-faint">DUE</span>
              <span className="ml-auto text-xs text-fg tabular-nums">
                {fmtShortDate(card.dueDate)}
              </span>
            </div>
          )}

          {/* Description preview — 240 chars + ellipsis. Hidden when blank. */}
          {descPreview && (
            <div
              className="space-y-1 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
              data-testid="card-quick-view-description"
            >
              <span className="mono-meta-sm text-fg-faint">DESCRIPTION</span>
              <p className="text-xs leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
                {descPreview}
              </p>
            </div>
          )}

          {/* Subtask count — read-only summary. */}
          {subtaskTotal > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
              data-testid="card-quick-view-subtasks"
            >
              <ListTodo className="size-3 text-fg-faint" aria-hidden />
              <span className="mono-meta-sm text-fg-faint">SUBTASKS</span>
              <span className="ml-auto text-xs text-fg tabular-nums">
                {subtaskDone}/{subtaskTotal}
              </span>
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
