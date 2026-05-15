"use client";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Bug,
  CheckSquare,
  CircleDot,
  Layers3,
  ListTodo,
  Plus,
  Square,
} from "lucide-react";
import { AssigneePicker } from "./assignee-picker";
import { DatePicker } from "@/components/ui/date-picker";
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
import { BoardStoreContext } from "@/stores/board-store";

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

export type QuickViewCardType = "story" | "task" | "subtask" | "bug";
type QuickViewSubtask = {
  id: string;
  title: string;
  type?: string | null;
  completedAt?: Date | string | null;
  dueComplete?: boolean;
  position?: string;
};

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
  value: string;
  label: string;
  Icon: typeof Square;
  text: string;
  ringSelected: string;
  bgSelected: string;
};
const TYPE_OPTIONS: TypeOption[] = [
  {
    value: "story", label: "Story", Icon: BookOpen,
    text: "text-sky-300",
    ringSelected: "ring-sky-400/60",
    bgSelected: "bg-sky-500/15",
  },
  {
    value: "task", label: "Task", Icon: Square,
    text: "text-fg-muted",
    ringSelected: "ring-fg/40",
    bgSelected: "bg-[rgb(255_255_255/0.10)]",
  },
  {
    value: "subtask", label: "Subtask", Icon: CheckSquare,
    text: "text-emerald-300",
    ringSelected: "ring-emerald-400/60",
    bgSelected: "bg-emerald-500/15",
  },
  {
    value: "bug", label: "Bug", Icon: Bug,
    text: "text-rose-300",
    ringSelected: "ring-rose-400/60",
    bgSelected: "bg-rose-500/15",
  },
];
const LEGACY_SUBBOARD_OPTION: TypeOption = {
  value: "legacy-subboard",
  label: "Sub-board",
  Icon: Layers3,
  text: "text-violet-300",
  ringSelected: "ring-violet-400/60",
  bgSelected: "bg-violet-500/15",
};
const PRIORITY_OPTIONS: readonly (CardPriority | "")[] = [
  "",
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
];

// Normalize a stored date (Date | string | null) into a UTC midnight Date,
// so the calendar grid renders against the same day that was persisted
// (the DB stores noon-UTC; the picker wants 00:00-UTC of the same day).
function toDateValue(d: Date | string | null | undefined): Date | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
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
  const cardType = card.type ?? "task";
  const typeOptions = TYPE_OPTIONS.some((opt) => opt.value === cardType)
    ? TYPE_OPTIONS
    : [{ ...LEGACY_SUBBOARD_OPTION, value: cardType }, ...TYPE_OPTIONS];
  const currentPriority = (card.priority ?? null) as CardPriority | null;
  const subtaskRows = useQuickViewSubtasks(card.id);

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
  // Type is intentionally NOT editable here — same rationale as TypePicker
  // (2026-05-14). Changing type after creation violates DB invariants and
  // surfaces opaque errors; the TYPE row below renders as a static chip.
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
    (v: Date | null) => {
      void onPatch?.({ startDate: v });
    },
    [onPatch],
  );
  const setTargetDate = useCallback(
    (v: Date | null) => {
      void onPatch?.({ targetDate: v });
    },
    [onPatch],
  );
  function openAdvanced(e?: React.MouseEvent<HTMLButtonElement>) {
    e?.preventDefault();
    e?.stopPropagation();
    // Do NOT call the onClose handler here. When the quick-view was
    // opened from the roadmap, roadmap-view's onOpenChange runs
    // restoreRoadmapCardOrigin on close — which clears the sessionStorage
    // breadcrumb AND replaces the URL with /roadmap. Both side-effects
    // break the "close detail returns to roadmap" flow: the breadcrumb
    // is then unavailable to card-modal close. Just navigate; the
    // roadmap-view unmounts when the URL changes and the dialog
    // disappears with it.
    router.push(`/b/${boardId}/c/${card.id}`, { scroll: false });
  }

  // Members: prefer the explicit availableMembers prop; otherwise fall back
  // to the assigned list (read-only display).
  const memberPool: QuickViewMember[] =
    availableMembers && membersEditable ? availableMembers : memberProfiles;
  const assignedIds = new Set(memberProfiles.map((p) => p.id));

  return (
    <>
      <DialogHeader className="min-w-0 pr-10 overflow-hidden">
        <DialogTitle
          data-testid="card-quick-view-title"
          className={`min-w-0 max-w-full ${completed ? "line-through text-fg-muted" : ""}`}
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
              title={card.title}
              className={`block min-w-0 max-w-full truncate ${editable ? "cursor-text" : ""}`}
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {card.title}
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        {/* TYPE row — display-only chip. Type is fixed at creation; see
            TypePicker for rationale. */}
        <div className="space-y-1 text-xs">
          <span className="mono-meta-sm text-fg-faint">TYPE</span>
          <div className="grid grid-cols-4 gap-1.5" aria-label="Card type">
            {typeOptions.map((opt) => {
              const selected = cardType === opt.value;
              return (
                <span
                  key={opt.value}
                  data-selected={selected ? "true" : undefined}
                  data-active={selected ? "true" : "false"}
                  data-testid={selected ? "card-quick-view-type" : undefined}
                  title="Type is fixed at creation"
                  className={[
                    "inline-flex items-center justify-center gap-1.5",
                    "rounded-full border px-2.5 py-1.5",
                    "mono-meta-sm cursor-default",
                    opt.text,
                    selected
                      ? `ring-1 ${opt.ringSelected} ${opt.bgSelected} border-transparent`
                      : "opacity-80 border-hairline",
                  ].join(" ")}
                >
                  <opt.Icon className="size-3.5" aria-hidden />
                  <span>{opt.label.toUpperCase()}</span>
                </span>
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
            <div className="space-y-1.5">
              <span className="mono-meta-sm text-fg-faint">START</span>
              {editable ? (
                <div data-testid="card-quick-view-start-edit">
                  <DatePicker
                    value={toDateValue(card.startDate)}
                    onChange={setStartDate}
                    triggerLabel="Set start"
                    inputLabel="Start date"
                  />
                </div>
              ) : (
                <div className="flex h-8 items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.startDate ? formatDate(card.startDate) : "—"}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              {editable ? (
                <div data-testid="card-quick-view-target-edit">
                  <DatePicker
                    value={toDateValue(card.targetDate)}
                    onChange={setTargetDate}
                    triggerLabel="Set target"
                    inputLabel="Target date"
                  />
                </div>
              ) : (
                <div className="flex h-8 items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {card.targetDate ? formatDate(card.targetDate) : "—"}
                </div>
              )}
            </div>
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

        {/* SUBTASKS — child rows + inline add affordance. */}
        {(subtaskTotal > 0 || subtaskCreatable) && (
          <SubtaskSection
            subtaskDone={subtaskDone}
            subtaskTotal={subtaskTotal}
            subtasks={subtaskRows}
            creatable={subtaskCreatable}
            onCreateSubtask={onCreateSubtask}
            boardId={boardId}
            router={router}
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

      <DialogFooter className="items-center justify-between !px-2 sm:justify-between">
        <Button
          type="button"
          onClick={openAdvanced}
          data-testid="card-quick-view-open-advanced"
        >
          Open advanced settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          data-testid="card-quick-view-close"
        >
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function useQuickViewSubtasks(cardId: string): QuickViewSubtask[] {
  const store = useContext(BoardStoreContext);
  const selectRows = useCallback(() => {
    if (!store) return [];
    return store
      .getState()
      .cards
      .filter((c) => c.parentCardId === cardId && !c.archived)
      .map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        completedAt: c.completedAt,
        dueComplete: c.dueComplete,
        position: c.position,
      }))
      .sort((a, b) => ((a.position ?? "") < (b.position ?? "") ? -1 : 1));
  }, [cardId, store]);
  const [rows, setRows] = useState<QuickViewSubtask[]>(() => selectRows());

  useEffect(() => {
    setRows(selectRows());
    if (!store) return;
    return store.subscribe(() => {
      setRows(selectRows());
    });
  }, [selectRows, store]);

  return useMemo(() => rows, [rows]);
}

// Inline subtask block: shows child rows and (when creatable) a
// single-line input to add another subtask. The parent (card-tile or
// roadmap-view) is responsible for the actual createCard server call.
function SubtaskSection({
  subtaskDone,
  subtaskTotal,
  subtasks,
  creatable,
  onCreateSubtask,
  boardId,
  router,
}: {
  subtaskDone: number;
  subtaskTotal: number;
  subtasks: QuickViewSubtask[];
  creatable: boolean;
  onCreateSubtask?: (title: string) => Promise<void> | void;
  boardId: string;
  router: ReturnType<typeof useRouter>;
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
          <ul className="divide-y divide-hairline" data-testid="card-quick-view-subtask-list">
            {subtasks.length > 0
              ? subtasks.map((subtask) => {
                  const done =
                    subtask.completedAt != null || Boolean(subtask.dueComplete);
                  return (
                    <li key={subtask.id}>
                      <button
                        type="button"
                        className="flex min-h-[34px] w-full items-center gap-1.5 px-2 text-left hover:bg-[rgb(255_255_255/0.04)]"
                        data-testid="card-quick-view-subtask-row"
                        data-subtask-id={subtask.id}
                        data-status={done ? "done" : "open"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(`/b/${boardId}/c/${subtask.id}`, {
                            scroll: false,
                          });
                        }}
                      >
                        <ListTodo className="size-3 text-fg-faint" aria-hidden />
                        <span
                          className={`min-w-0 flex-1 truncate text-xs ${
                            done ? "line-through text-fg-muted" : "text-fg"
                          }`}
                        >
                          {subtask.title}
                        </span>
                        <span className="mono-meta-sm text-fg-faint">
                          {done ? "DONE" : "OPEN"}
                        </span>
                      </button>
                    </li>
                  );
                })
              : Array.from({ length: subtaskTotal }, (_, index) => {
                  const done = index < subtaskDone;
                  return (
                    <li
                      key={`placeholder-${index}`}
                      className="flex min-h-[34px] items-center gap-1.5 px-2"
                      data-testid="card-quick-view-subtask-row"
                      data-status={done ? "done" : "open"}
                    >
                      <ListTodo className="size-3 text-fg-faint" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                        Subtask {index + 1}
                      </span>
                      <span className="mono-meta-sm text-fg-faint">
                        {done ? "DONE" : "OPEN"}
                      </span>
                    </li>
                  );
                })}
          </ul>
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
