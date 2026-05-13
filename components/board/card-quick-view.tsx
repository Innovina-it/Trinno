"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, CalendarClock, CircleDot, ListTodo, Mountain, Plus, Square } from "lucide-react";
import { AssigneePicker } from "./assignee-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PriorityChip, type CardPriority } from "./card/priority-picker";
import { formatDate } from "@/lib/format-date";

// Plan: Quick card view on double-click. Editable summary surfaced from the
// board / workspace store. All fields are inline-editable when the parent
// passes `onPatch` + `onToggleMember`; if either prop is undefined the
// fields render plain text (read-only fallback). Mirrors the clinical,
// dense kanban aesthetic — tinted neutrals, no decorative gradients.
//
// The component is store-agnostic — it accepts already-resolved card data,
// member profiles, and an `availableMembers` list via props. The board
// surface (card-tile.tsx) and the roadmap surface (roadmap-view.tsx) each
// compute the props from their own zustand store. This keeps the
// component reusable across parent layouts where the parallel-route
// modal intercept does NOT cross (e.g. /w/[workspaceId]/roadmap ↔
// /b/[boardId]/c/[cardId]).

export type QuickViewProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type QuickViewMember = {
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

export type QuickViewCardType = "task" | "story" | "bug" | "epic";

export type PatchInput = {
  title?: string;
  description?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean;
  completed?: boolean;
  type?: QuickViewCardType;
  priority?: CardPriority | null;
  startDate?: Date | string | null;
  targetDate?: Date | string | null;
};

type TypeOption = {
  value: QuickViewCardType;
  label: string;
  Icon: typeof Square;
  text: string;
  ringSelected: string;
  bgSelected: string;
};
// Story hidden from the picker (UX simplification, 2026-05-13). Legacy
// story-typed cards keep their stored type and render as such elsewhere.
const TYPE_OPTIONS: TypeOption[] = [
  {
    value: "task", label: "Task", Icon: Square,
    text: "text-fg-muted",
    ringSelected: "ring-fg/40",
    bgSelected: "bg-[rgb(255_255_255/0.10)]",
  },
  {
    value: "bug", label: "Bug", Icon: Bug,
    text: "text-rose-300",
    ringSelected: "ring-rose-400/60",
    bgSelected: "bg-rose-500/15",
  },
  {
    value: "epic", label: "Epic", Icon: Mountain,
    text: "text-violet-300",
    ringSelected: "ring-violet-400/60",
    bgSelected: "bg-violet-500/15",
  },
];
const PRIORITY_OPTIONS: readonly (CardPriority | "")[] = [
  "",
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
];

// Convert a stored date (Date | string | null) into the YYYY-MM-DD string
// that <input type="date"> expects.  Empty string when null/invalid.
function toDateInput(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  // Use UTC to match fmtShortDate above; avoids local-tz drift across
  // midnight that would shift an "Apr 30" stored date to "Apr 29".
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CardQuickView({
  card,
  memberProfiles,
  availableMembers,
  subtaskTotal,
  subtaskDone,
  boardId,
  open,
  onOpenChange,
  onPatch,
  onToggleMember,
  onCreateSubtask,
}: {
  card: QuickViewCard | null;
  memberProfiles: QuickViewProfile[];
  /** Full list of members the user can pick from. Optional — falls back
   *  to memberProfiles (read-only display) when undefined. */
  availableMembers?: QuickViewMember[];
  subtaskTotal: number;
  subtaskDone: number;
  boardId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** When provided, fields become inline-editable. Caller is responsible
   *  for optimistic store updates + server action. */
  onPatch?: (patch: PatchInput) => Promise<void> | void;
  /** When provided, assignee chips become toggleable. */
  onToggleMember?: (userId: string) => Promise<void> | void;
  /** When provided, inline "Add subtask" affordance is rendered. */
  onCreateSubtask?: (title: string) => Promise<void> | void;
}) {
  const router = useRouter();
  const editable = typeof onPatch === "function";
  const membersEditable = typeof onToggleMember === "function";
  const subtaskCreatable = typeof onCreateSubtask === "function";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="card-quick-view" className="sm:max-w-md">
        <CardQuickViewBody
          card={card}
          memberProfiles={memberProfiles}
          availableMembers={availableMembers}
          subtaskTotal={subtaskTotal}
          subtaskDone={subtaskDone}
          boardId={boardId}
          editable={editable}
          membersEditable={membersEditable}
          subtaskCreatable={subtaskCreatable}
          onPatch={onPatch}
          onToggleMember={onToggleMember}
          onCreateSubtask={onCreateSubtask}
          onClose={() => onOpenChange(false)}
          router={router}
        />
      </DialogContent>
    </Dialog>
  );
}

// Body is split out so its local hooks unmount/remount cleanly when the
// dialog is reopened against a different card. Avoids stale draft values
// leaking across cards.
function CardQuickViewBody({
  card,
  memberProfiles,
  availableMembers,
  subtaskTotal,
  subtaskDone,
  boardId,
  editable,
  membersEditable,
  subtaskCreatable,
  onPatch,
  onToggleMember,
  onCreateSubtask,
  onClose,
  router,
}: {
  card: QuickViewCard;
  memberProfiles: QuickViewProfile[];
  availableMembers?: QuickViewMember[];
  subtaskTotal: number;
  subtaskDone: number;
  boardId: string;
  editable: boolean;
  membersEditable: boolean;
  subtaskCreatable: boolean;
  onPatch?: (patch: PatchInput) => Promise<void> | void;
  onToggleMember?: (userId: string) => Promise<void> | void;
  onCreateSubtask?: (title: string) => Promise<void> | void;
  onClose: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const completed = card.completedAt != null || card.dueComplete;
  const cardType = (card.type ?? "task") as QuickViewCardType;
  const currentPriority = (card.priority ?? null) as CardPriority | null;

  // === TITLE — inline edit on click; commit on blur or Enter; cancel on Esc ===
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const titleCommitRef = useRef(false);
  // Sync draft when the prop changes (parent store mutated externally).
  useEffect(() => {
    if (!titleEditing) setTitleDraft(card.title);
  }, [card.title, titleEditing]);

  const commitTitle = useCallback(() => {
    titleCommitRef.current = true;
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!next || next === card.title) {
      setTitleDraft(card.title);
      return;
    }
    void onPatch?.({ title: next });
  }, [titleDraft, card.title, onPatch]);

  const cancelTitle = useCallback(() => {
    titleCommitRef.current = true;
    setTitleEditing(false);
    setTitleDraft(card.title);
  }, [card.title]);

  // === DESCRIPTION — textarea; commit on blur ===
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(card.description ?? "");
  useEffect(() => {
    if (!descEditing) setDescDraft(card.description ?? "");
  }, [card.description, descEditing]);

  const commitDesc = useCallback(() => {
    setDescEditing(false);
    const next = descDraft;
    const prev = card.description ?? "";
    if (next === prev) return;
    void onPatch?.({ description: next.length === 0 ? null : next });
  }, [descDraft, card.description, onPatch]);

  // === Helpers for select / date / chip handlers ===
  const setType = useCallback(
    (t: QuickViewCardType) => {
      if (t === cardType) return;
      void onPatch?.({ type: t });
    },
    [cardType, onPatch],
  );

  const setPriority = useCallback(
    (p: CardPriority | null) => {
      if (p === currentPriority) return;
      void onPatch?.({ priority: p });
    },
    [currentPriority, onPatch],
  );

  const toggleCompleted = useCallback(() => {
    void onPatch?.({ completed: !completed });
  }, [completed, onPatch]);

  const setStartDate = useCallback(
    (v: string) => {
      const next: Date | string | null = v ? v : null;
      void onPatch?.({ startDate: next });
    },
    [onPatch],
  );
  const setTargetDate = useCallback(
    (v: string) => {
      const next: Date | string | null = v ? v : null;
      void onPatch?.({ targetDate: next });
    },
    [onPatch],
  );
  const setDueDate = useCallback(
    (v: string) => {
      const next: Date | string | null = v ? v : null;
      void onPatch?.({ dueDate: next });
    },
    [onPatch],
  );

  function openAdvanced() {
    onClose();
    router.push(`/b/${boardId}/c/${card.id}`, { scroll: false });
  }

  // Members: prefer the explicit availableMembers prop; otherwise fall back
  // to the assigned list (read-only display).
  const memberPool: QuickViewMember[] =
    availableMembers && membersEditable ? availableMembers : memberProfiles;
  const assignedIds = new Set(memberProfiles.map((p) => p.id));

  return (
    <>
      <DialogHeader>
        <DialogTitle
          data-testid="card-quick-view-title"
          className={completed ? "line-through text-fg-muted" : ""}
        >
          {editable && titleEditing ? (
            <input
              data-testid="card-quick-view-title-edit"
              type="text"
              value={titleDraft}
              maxLength={120}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (titleCommitRef.current) {
                  titleCommitRef.current = false;
                  return;
                }
                commitTitle();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelTitle();
                }
              }}
              className="w-full bg-transparent border-0 outline-none ring-0 p-0 m-0 text-base font-semibold leading-tight focus:underline decoration-fg/40"
              style={{ fontFamily: "inherit" }}
            />
          ) : (
            <span
              onClick={() => editable && setTitleEditing(true)}
              className={editable ? "cursor-text" : undefined}
            >
              {card.title}
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        {/* TYPE row — mirrors the new-card pill row, one slot active. */}
        <div className="space-y-1 text-xs">
          <span className="mono-meta-sm text-fg-faint">TYPE</span>
          <div className="grid grid-cols-4 gap-1.5" aria-label="Card type">
            {TYPE_OPTIONS.map((opt) => {
              const selected = cardType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!editable}
                  data-selected={selected ? "true" : undefined}
                  data-testid={
                    selected ? "card-quick-view-type" : undefined
                  }
                  onClick={() => setType(opt.value)}
                  className={[
                    "inline-flex items-center justify-center gap-1.5",
                    "rounded-full border px-2.5 py-1.5",
                    "mono-meta-sm transition-colors",
                    opt.text,
                    selected
                      ? `ring-1 ${opt.ringSelected} ${opt.bgSelected} border-transparent`
                      : "border-hairline",
                    editable && !selected
                      ? "hover:opacity-80"
                      : "",
                    editable ? "cursor-pointer" : "cursor-default",
                  ].join(" ")}
                >
                  <opt.Icon className="size-3.5" aria-hidden />
                  <span>{opt.label.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* PRIORITY + STATUS — two-column row, always rendered. */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="mono-meta-sm text-fg-faint">PRIORITY</span>
            {editable ? (
              <label className="relative flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2">
                {currentPriority ? (
                  <PriorityChip priority={currentPriority} />
                ) : (
                  <span className="mono-meta-sm text-fg-faint">—</span>
                )}
                <select
                  data-testid="card-quick-view-priority-edit"
                  value={currentPriority ?? ""}
                  onChange={(e) =>
                    setPriority(
                      e.target.value === ""
                        ? null
                        : (e.target.value as CardPriority),
                    )
                  }
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Priority"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p || "none"} value={p}>
                      {p === "" ? "— None" : p.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2">
                {currentPriority ? (
                  <PriorityChip priority={currentPriority} />
                ) : (
                  <span className="mono-meta-sm text-fg-faint">—</span>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <span className="mono-meta-sm text-fg-faint">STATUS</span>
            <button
              type="button"
              disabled={!editable}
              onClick={toggleCompleted}
              data-testid="card-quick-view-completion"
              data-completed={completed ? "true" : "false"}
              className={[
                "flex h-[34px] w-full items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2 transition-colors",
                editable
                  ? "cursor-pointer hover:bg-[rgb(255_255_255/0.06)]"
                  : "cursor-default",
              ].join(" ")}
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
            </button>
          </div>
        </div>

        {/* START / TARGET — two-column date row, parallels new-card dialog.
            Rendered when editing is on (so users can fill them in) or when
            either date is set. */}
        {(editable || card.startDate || card.targetDate) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <span className="mono-meta-sm text-fg-faint">START</span>
              {editable ? (
                <input
                  data-testid="card-quick-view-start-edit"
                  type="date"
                  value={toDateInput(card.startDate)}
                  onChange={(e) => setStartDate(e.target.value)}
                  aria-label="Start date"
                  className="flex h-[34px] w-full items-center rounded-md border border-hairline bg-transparent px-2 text-xs text-fg tabular-nums outline-none focus:border-hairline-hi"
                />
              ) : (
                <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.startDate ? formatDate(card.startDate) : "—"}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              {editable ? (
                <input
                  data-testid="card-quick-view-target-edit"
                  type="date"
                  value={toDateInput(card.targetDate)}
                  onChange={(e) => setTargetDate(e.target.value)}
                  aria-label="Target date"
                  className="flex h-[34px] w-full items-center rounded-md border border-hairline bg-transparent px-2 text-xs text-fg tabular-nums outline-none focus:border-hairline-hi"
                />
              ) : (
                <div className="flex h-[34px] items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.targetDate ? formatDate(card.targetDate) : "—"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DUE — single row. Always rendered when editing so users can set
            it; otherwise only when populated. */}
        {(editable || card.dueDate) && (
          <div className="space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">DUE</span>
            {editable ? (
              <label
                data-testid="card-quick-view-due"
                className="flex h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2"
              >
                <CalendarClock
                  className="size-3 text-fg-faint"
                  aria-hidden
                />
                <input
                  data-testid="card-quick-view-due-edit"
                  type="date"
                  value={toDateInput(card.dueDate)}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date"
                  className="flex-1 bg-transparent text-xs text-fg tabular-nums outline-none"
                />
              </label>
            ) : (
              <div
                data-testid="card-quick-view-due"
                className="flex h-[34px] items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2"
              >
                <CalendarClock
                  className="size-3 text-fg-faint"
                  aria-hidden
                />
                <span className="text-fg tabular-nums">
                  {card.dueDate ? formatDate(card.dueDate) : "—"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ASSIGNEES — dropdown multi-select when editable; read-only chip
            list otherwise. */}
        <div className="space-y-1 text-xs">
          <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
          {membersEditable && memberPool.length > 0 ? (
            <AssigneePicker
              members={memberPool.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                avatarUrl: p.avatarUrl,
              }))}
              selected={assignedIds}
              onToggle={(id) => void onToggleMember?.(id)}
              testId="card-quick-view-assignees"
            />
          ) : memberProfiles.length > 0 ? (
            <ul className="flex flex-wrap gap-1" data-testid="card-quick-view-assignees">
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
            <p
              className="mono-meta-sm text-fg-faint"
              data-testid="card-quick-view-assignees"
            >
              Unassigned
            </p>
          )}
        </div>

        {/* SUBTASKS — count summary + inline add affordance. */}
        {(subtaskTotal > 0 || subtaskCreatable) && (
          <SubtaskSection
            subtaskDone={subtaskDone}
            subtaskTotal={subtaskTotal}
            creatable={subtaskCreatable}
            onCreateSubtask={onCreateSubtask}
          />
        )}

        {/* DESCRIPTION — textarea when editing; preview when not. */}
        {(editable || (card.description ?? "").length > 0) && (
          <div className="space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">DESCRIPTION</span>
            {editable ? (
              <textarea
                data-testid="card-quick-view-description-edit"
                value={descDraft}
                rows={3}
                onFocus={() => setDescEditing(true)}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={commitDesc}
                placeholder="Add a description…"
                className="block w-full resize-y rounded-md border border-hairline bg-transparent px-2 py-1.5 text-xs leading-relaxed text-fg-muted outline-none focus:border-hairline-hi"
              />
            ) : (
              <div
                data-testid="card-quick-view-description"
                className="rounded-md border border-hairline bg-transparent px-2 py-1.5"
              >
                <p className="text-xs leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
                  {card.description ?? ""}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          onClick={openAdvanced}
          data-testid="card-quick-view-open-advanced"
        >
          Open advanced settings
        </Button>
      </DialogFooter>
    </>
  );
}

// Inline subtask block: shows the done/total count and (when creatable)
// a single-line input to add another subtask. The parent (card-tile or
// roadmap-view) is responsible for the actual createCard server call;
// this component just collects a title and calls back.
function SubtaskSection({
  subtaskDone,
  subtaskTotal,
  creatable,
  onCreateSubtask,
}: {
  subtaskDone: number;
  subtaskTotal: number;
  creatable: boolean;
  onCreateSubtask?: (title: string) => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  async function commit() {
    const title = draft.trim();
    if (!title || !onCreateSubtask) {
      setAdding(false);
      setDraft("");
      return;
    }
    setBusy(true);
    try {
      await onCreateSubtask(title);
      setDraft("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-xs">
      <span className="mono-meta-sm text-fg-faint">SUBTASKS</span>
      <div
        data-testid="card-quick-view-subtasks"
        className="rounded-md border border-hairline bg-transparent"
      >
        {subtaskTotal > 0 && (
          <div className="flex h-[34px] items-center gap-1.5 px-2 border-b border-hairline">
            <ListTodo className="size-3 text-fg-faint" aria-hidden />
            <span className="text-fg tabular-nums">
              {subtaskDone}/{subtaskTotal}
            </span>
          </div>
        )}
        {creatable && (
          adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void commit();
              }}
              className="flex h-[34px] items-center gap-1.5 px-2"
            >
              <Plus className="size-3 text-fg-faint" aria-hidden />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraft("");
                  }
                }}
                disabled={busy}
                placeholder="Subtask title…"
                className="flex-1 bg-transparent outline-none text-xs text-fg placeholder:text-fg-faint"
                data-testid="card-quick-view-subtask-input"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-[34px] w-full items-center gap-1.5 px-2 text-left text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.04)]"
              data-testid="card-quick-view-add-subtask"
            >
              <Plus className="size-3 text-fg-faint" aria-hidden />
              <span className="text-xs">Add subtask</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
