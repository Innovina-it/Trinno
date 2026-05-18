"use client";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  FolderKanban,
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
import { WorkspaceStoreContext } from "@/stores/workspace-store";
import {
  promoteCardToSubboard,
  detachCardSubboard,
  deleteBoard,
} from "@/actions/boards";
import { errorBus } from "@/lib/errors/error-bus";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";

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
  // Optional — Story is icon-less. Legacy fallbacks and the other types
  // still carry their distinguishing glyph.
  Icon?: typeof Square;
  text: string;
  ringSelected: string;
  bgSelected: string;
};
// Subtask is no longer a selectable type. Existing rows with
// type='subtask' resolve via LEGACY_SUBTASK_OPTION below so the chip
// still renders with the correct label / icon.
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
];
const LEGACY_SUBBOARD_OPTION: TypeOption = {
  value: "legacy-subboard",
  label: "Sub-board",
  Icon: Layers3,
  text: "text-violet-300",
  ringSelected: "ring-violet-400/60",
  bgSelected: "bg-violet-500/15",
};
const LEGACY_SUBTASK_OPTION: TypeOption = {
  value: "subtask",
  label: "Subtask",
  Icon: CheckSquare,
  text: "text-emerald-300",
  ringSelected: "ring-emerald-400/60",
  bgSelected: "bg-emerald-500/15",
};
const LEGACY_STORY_OPTION: TypeOption = {
  value: "story",
  label: "Story",
  text: "text-sky-300",
  ringSelected: "ring-sky-400/60",
  bgSelected: "bg-sky-500/15",
};
// UX-only option in the picker. Selected ↔ card has 1:1 sub-board
// attached. Click handler promotes; never written to `cards.type`.
const SUBBOARD_TYPE_OPTION: TypeOption = {
  value: "sub-board",
  label: "Sub-board",
  Icon: FolderKanban,
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

  // Shared between wrapper + body so the wrapper can intercept dialog
  // dismiss attempts (X icon, Esc, outside click) when the body has
  // unsaved drafts and force the user through the confirm phase.
  const dirtyRef = useRef(false);
  const enterConfirmRef = useRef<() => void>(() => {});

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && dirtyRef.current) {
        enterConfirmRef.current();
        return;
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="card-quick-view"
        className="sm:max-w-md"
        showCloseButton={false}
      >
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
          dirtyRef={dirtyRef}
          enterConfirmRef={enterConfirmRef}
        />
      </DialogContent>
    </Dialog>
  );
}

// Body is split out so its local hooks unmount/remount cleanly when the
// dialog is reopened against a different card. Avoids stale draft values
// leaking across cards.
//
// Deferred-commit model (2026-05-15): field edits write to local drafts
// only. The footer Close button morphs into "Save" when any draft differs
// from the card prop. Save → confirm phase → onPatch + close. Discard
// → revert drafts + close. The dirty state is exposed up to the wrapper
// via dirtyRef so dismiss attempts (X, Esc, outside-click) also funnel
// into the confirm phase instead of silently dropping edits.
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
  dirtyRef,
  enterConfirmRef,
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
  dirtyRef: React.MutableRefObject<boolean>;
  enterConfirmRef: React.MutableRefObject<() => void>;
}) {
  const baseCompleted = card.completedAt != null || card.dueComplete;
  const baseDescription = card.description ?? "";
  const basePriority = (card.priority ?? null) as CardPriority | null;
  const cardType = card.type ?? "task";
  // Resolve type options. If the card's type isn't in TYPE_OPTIONS (e.g.
  // it's a legacy 'subtask' row created before subtask was retired from
  // the picker, or an epic-era 'legacy-subboard' value), prepend a
  // display-only legacy entry so the chip renders with the right label.
  const legacyOption =
    cardType === "subtask"
      ? LEGACY_SUBTASK_OPTION
      : cardType === "story"
        ? LEGACY_STORY_OPTION
        : { ...LEGACY_SUBBOARD_OPTION, value: cardType };
  // Sub-board promote affordance lives inline in the TYPE picker too,
  // gated on the workspace flag + presence of BoardStoreContext. When the
  // qv is opened from the roadmap (no store), the option is hidden.
  const subboardCtx = useQuickViewSubboardContext(card.id);
  const subboardsEnabled = useWorkspaceFlag("subboards_enabled", true);
  // Confirm modal for detaching the attached sub-board. Replaces the
  // previous window.confirm — same prompt body, two action paths
  // (Detach / Detach + Delete).
  const [subboardConfirmOpen, setSubboardConfirmOpen] = useState(false);
  const showSubboardOption = subboardCtx !== null && subboardsEnabled;
  const baseOptions = showSubboardOption
    ? [...TYPE_OPTIONS, SUBBOARD_TYPE_OPTION]
    : TYPE_OPTIONS;
  const typeOptions = baseOptions.some((opt) => opt.value === cardType)
    ? baseOptions
    : [legacyOption, ...baseOptions];
  const subtaskRows = useQuickViewSubtasks(card.id);

  // === Local drafts (deferred commit) ===
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [descDraft, setDescDraft] = useState(baseDescription);
  const [priorityDraft, setPriorityDraft] =
    useState<CardPriority | null>(basePriority);
  const [completedDraft, setCompletedDraft] = useState(baseCompleted);
  const [typeDraft, setTypeDraft] = useState<QuickViewCardType>(
    cardType as QuickViewCardType,
  );
  const [startDraft, setStartDraft] =
    useState<Date | string | null>(card.startDate);
  const [targetDraft, setTargetDraft] =
    useState<Date | string | null>(card.targetDate);

  const [titleEditing, setTitleEditing] = useState(false);
  const titleCommitRef = useRef(false);
  const [descEditing, setDescEditing] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const exitTitleEdit = useCallback(() => {
    titleCommitRef.current = true;
    setTitleEditing(false);
  }, []);
  const cancelTitle = useCallback(() => {
    // Esc reverts the in-progress edit to the last persisted value.
    titleCommitRef.current = true;
    setTitleEditing(false);
    setTitleDraft(card.title);
  }, [card.title]);

  // === Dirty diff (drafts vs card props) ===
  const dateMs = (v: Date | string | null) => {
    const d = toDateValue(v);
    return d ? d.getTime() : null;
  };
  const trimmedTitle = titleDraft.trim();
  const titleChanged =
    trimmedTitle.length > 0 && trimmedTitle !== card.title;
  const descChanged = descDraft !== baseDescription;
  const priorityChanged = priorityDraft !== basePriority;
  const completedChanged = completedDraft !== baseCompleted;
  const typeChanged = typeDraft !== cardType;
  const startChanged = dateMs(startDraft) !== dateMs(card.startDate);
  const targetChanged = dateMs(targetDraft) !== dateMs(card.targetDate);
  const dirty =
    titleChanged ||
    descChanged ||
    priorityChanged ||
    completedChanged ||
    typeChanged ||
    startChanged ||
    targetChanged;

  // Surface dirty + confirm hook to the wrapper so dismiss attempts
  // (X icon, Esc, outside-click) divert into the confirm phase.
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);
  useEffect(() => {
    enterConfirmRef.current = () => setConfirming(true);
  }, [enterConfirmRef]);
  useEffect(() => {
    return () => {
      dirtyRef.current = false;
    };
  }, [dirtyRef]);

  const resetDrafts = useCallback(() => {
    setTitleDraft(card.title);
    setDescDraft(baseDescription);
    setPriorityDraft(basePriority);
    setCompletedDraft(baseCompleted);
    setTypeDraft(cardType as QuickViewCardType);
    setStartDraft(card.startDate);
    setTargetDraft(card.targetDate);
    setTitleEditing(false);
    setDescEditing(false);
    setConfirming(false);
    dirtyRef.current = false;
  }, [
    card.title,
    card.startDate,
    card.targetDate,
    baseDescription,
    basePriority,
    baseCompleted,
    cardType,
    dirtyRef,
  ]);

  const onSaveClick = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirming(true);
  }, [dirty, onClose]);

  const commitSave = useCallback(async () => {
    if (saving) return;
    const patch: PatchInput = {};
    if (titleChanged) patch.title = trimmedTitle;
    if (descChanged) patch.description = descDraft.length === 0 ? null : descDraft;
    if (priorityChanged) patch.priority = priorityDraft;
    if (completedChanged) patch.completed = completedDraft;
    if (typeChanged) patch.type = typeDraft;
    if (startChanged) patch.startDate = startDraft;
    if (targetChanged) patch.targetDate = targetDraft;
    if (Object.keys(patch).length === 0) {
      setConfirming(false);
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onPatch?.(patch);
      dirtyRef.current = false;
      setConfirming(false);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    titleChanged,
    descChanged,
    priorityChanged,
    completedChanged,
    typeChanged,
    startChanged,
    targetChanged,
    trimmedTitle,
    descDraft,
    priorityDraft,
    completedDraft,
    typeDraft,
    startDraft,
    targetDraft,
    onPatch,
    onClose,
    dirtyRef,
  ]);

  const discardAndClose = useCallback(() => {
    resetDrafts();
    onClose();
  }, [resetDrafts, onClose]);

  // === Field setters write to drafts (no server call) ===
  // Type is intentionally NOT editable here — same rationale as TypePicker
  // (2026-05-14). Changing type after creation violates DB invariants and
  // surfaces opaque errors; the TYPE row below renders as a static chip.
  const setPriority = useCallback((p: CardPriority | null) => {
    setPriorityDraft(p);
  }, []);
  const toggleCompleted = useCallback(() => {
    setCompletedDraft((prev) => !prev);
  }, []);
  const setStartDate = useCallback((v: Date | null) => {
    setStartDraft(v);
  }, []);
  const setTargetDate = useCallback((v: Date | null) => {
    setTargetDraft(v);
  }, []);

  // Derived view values
  const completed = completedDraft;
  const currentPriority = priorityDraft;

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
                exitTitleEdit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  exitTitleEdit();
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
              title={titleDraft}
              className={`block min-w-0 max-w-full truncate ${editable ? "cursor-text" : ""}`}
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {titleDraft}
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        {/* TYPE row — clickable when editable. Drafts roll into the
            confirm-save phase like every other field. Legacy options
            (subtask/story/sub-board) render as chips for back-compat but
            stay non-selectable: users can flip OUT of a legacy type but
            not INTO one from the picker. */}
        <div className="space-y-1 text-xs">
          <span className="mono-meta-sm text-fg-faint">TYPE</span>
          <div className="grid grid-cols-4 gap-1.5" aria-label="Card type">
            {typeOptions.map((opt) => {
              const isSubboardOpt = opt.value === "sub-board";
              const subboardSelected = isSubboardOpt && !!subboardCtx?.attached;
              const selected =
                isSubboardOpt
                  ? subboardSelected
                  : (editable ? typeDraft : cardType) === opt.value;
              const isLegacy =
                !isSubboardOpt &&
                !TYPE_OPTIONS.some((x) => x.value === opt.value);
              const clickable =
                isSubboardOpt
                  ? !!subboardCtx && !subboardCtx.busy
                  : editable && !isLegacy;
              const onClick = isSubboardOpt
                ? subboardCtx
                  ? () =>
                      subboardSelected
                        ? setSubboardConfirmOpen(true)
                        : subboardCtx.promote()
                  : undefined
                : clickable
                  ? () => setTypeDraft(opt.value as QuickViewCardType)
                  : undefined;
              const commonClass = [
                "inline-flex items-center justify-center gap-1.5",
                "rounded-full border px-2.5 py-1.5",
                "mono-meta-sm whitespace-nowrap",
                opt.text,
                selected
                  ? `ring-1 ${opt.ringSelected} ${opt.bgSelected} border-transparent`
                  : "opacity-80 border-hairline",
                clickable ? "cursor-pointer hover:opacity-100" : "cursor-default",
              ].join(" ");
              const dataProps = {
                "data-selected": selected ? "true" : undefined,
                "data-active": selected ? "true" : "false",
                "data-testid": selected ? "card-quick-view-type" : undefined,
              } as const;
              const inner = (
                <>
                  {opt.Icon && <opt.Icon className="size-3.5" aria-hidden />}
                  <span>{opt.label.toUpperCase()}</span>
                </>
              );
              return clickable ? (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={onClick}
                  className={commonClass}
                  {...dataProps}
                >
                  {inner}
                </button>
              ) : (
                <span
                  key={opt.value}
                  title={isLegacy ? "Legacy type — change to a current one to update" : undefined}
                  className={commonClass}
                  {...dataProps}
                >
                  {inner}
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
        {(editable || startDraft || targetDraft) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1.5">
              <span className="mono-meta-sm text-fg-faint">START</span>
              {editable ? (
                <div data-testid="card-quick-view-start-edit">
                  <DatePicker
                    value={toDateValue(startDraft)}
                    onChange={setStartDate}
                    triggerLabel="Set start"
                    inputLabel="Start date"
                  />
                </div>
              ) : (
                <div className="flex h-8 items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {startDraft ? formatDate(startDraft) : "—"}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              {editable ? (
                <div data-testid="card-quick-view-target-edit">
                  <DatePicker
                    value={toDateValue(targetDraft)}
                    onChange={setTargetDate}
                    triggerLabel="Set target"
                    inputLabel="Target date"
                  />
                </div>
              ) : (
                <div className="flex h-8 items-center rounded-md border border-hairline bg-transparent px-2 text-fg tabular-nums">
                  {targetDraft ? formatDate(targetDraft) : "—"}
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

        {/* SUB-BOARD — only mounted when BoardStoreContext is available.
            The qv is also rendered from the roadmap page where there is
            no board store, so the hooks must live inside this child. */}
        <QuickViewSubboardSection cardId={card.id} />

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
        {(editable || descDraft.length > 0) && (
          <div className="space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">DESCRIPTION</span>
            {editable ? (
              <textarea
                data-testid="card-quick-view-description-edit"
                value={descDraft}
                rows={3}
                onFocus={() => setDescEditing(true)}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={() => setDescEditing(false)}
                placeholder="Add a description…"
                className="block w-full resize-y rounded-md border border-hairline bg-transparent px-2 py-1.5 text-xs leading-relaxed text-fg-muted outline-none focus:border-hairline-hi"
              />
            ) : (
              <div
                data-testid="card-quick-view-description"
                className="rounded-md border border-hairline bg-transparent px-2 py-1.5"
              >
                <p className="text-xs leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
                  {descDraft}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <DialogFooter
        className="items-center justify-between !px-2 sm:justify-between"
        data-dirty={dirty ? "true" : "false"}
        data-confirming={confirming ? "true" : "false"}
      >
        {confirming ? (
          <>
            <span
              className="mono-meta-sm text-fg-muted"
              data-testid="card-quick-view-confirm-prompt"
            >
              Save changes?
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={discardAndClose}
                disabled={saving}
                data-testid="card-quick-view-discard"
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={() => void commitSave()}
                disabled={saving}
                data-testid="card-quick-view-confirm-save"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              type="button"
              onClick={openAdvanced}
              data-testid="card-quick-view-open-advanced"
            >
              Open advanced settings
            </Button>
            <Button
              type="button"
              variant={dirty ? "default" : "outline"}
              onClick={dirty ? onSaveClick : onClose}
              data-testid="card-quick-view-close"
              data-dirty={dirty ? "true" : "false"}
            >
              {dirty ? "Save" : "Close"}
            </Button>
          </>
        )}
      </DialogFooter>
      {subboardCtx?.attached && (
        <SubboardDetachConfirm
          open={subboardConfirmOpen}
          onOpenChange={setSubboardConfirmOpen}
          title={subboardCtx.attached.title}
          busy={subboardCtx.busy}
          onDetach={async () => {
            await subboardCtx.detach();
            setSubboardConfirmOpen(false);
          }}
          onDetachAndDelete={async () => {
            await subboardCtx.detach({ alsoDelete: true });
            setSubboardConfirmOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Confirm modal for detaching (or deleting) the attached sub-board.
 * Renders inside the qv's Dialog content as a small Base-UI Dialog so it
 * stacks above the qv backdrop without `window.confirm`'s ugliness.
 */
function SubboardDetachConfirm({
  open,
  onOpenChange,
  title,
  busy,
  onDetach,
  onDetachAndDelete,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  busy: boolean;
  onDetach: () => void | Promise<void>;
  onDetachAndDelete: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="card-quick-view-subboard-detach-confirm"
        className="sm:max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>Detach sub-board?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-muted">
          The card will no longer surface{" "}
          <span className="font-semibold text-fg">{title}</span> as its
          sub-board. The sub-board itself stays in the workspace board list
          unless you also choose to delete it.
        </p>
        <p className="text-xs text-fg-faint">
          <span className="font-semibold">Delete</span> drops the sub-board and
          all its lists / cards. This cannot be undone.
        </p>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="card-quick-view-subboard-detach-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void onDetach()}
            disabled={busy}
            data-testid="card-quick-view-subboard-detach-only"
          >
            Detach
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onDetachAndDelete()}
            disabled={busy}
            data-testid="card-quick-view-subboard-detach-and-delete"
          >
            Detach + Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sub-board context for the quick-view. Returns null when the qv is
 * rendered outside a BoardStoreProvider (roadmap usage). Hooks are always
 * called in the same order — the early null return happens after every
 * hook invocation.
 */
type QuickViewSubboardContext = {
  attached: { cardId: string; subBoardId: string; title: string } | null;
  promote: () => void;
  detach: (opts?: { alsoDelete?: boolean }) => Promise<void>;
  busy: boolean;
};
function useQuickViewSubboardContext(
  cardId: string,
): QuickViewSubboardContext | null {
  const boardStore = useContext(BoardStoreContext);
  const wsStore = useContext(WorkspaceStoreContext);

  // Subscribe to whichever store is present. BoardStore wins (freshness in
  // kanban context); WorkspaceStore is the roadmap fallback so the qv can
  // still surface promote + Open from a board-less view.
  const subscribeBoard = useCallback(
    (cb: () => void) => boardStore?.subscribe(cb) ?? (() => {}),
    [boardStore],
  );
  const getBoardAttached = useCallback(
    () =>
      boardStore
        ?.getState()
        .cardSubboards.find((x) => x.cardId === cardId) ?? null,
    [boardStore, cardId],
  );
  const boardAttached = useSyncExternalStore(
    subscribeBoard,
    getBoardAttached,
    getBoardAttached,
  );

  const subscribeWs = useCallback(
    (cb: () => void) => wsStore?.subscribe(cb) ?? (() => {}),
    [wsStore],
  );
  const getWsAttached = useCallback(
    () =>
      wsStore
        ?.getState()
        .subBoards.find((x) => x.parentCardId === cardId) ?? null,
    [wsStore, cardId],
  );
  const wsSubBoard = useSyncExternalStore(
    subscribeWs,
    getWsAttached,
    getWsAttached,
  );
  const wsAttached = useMemo(
    () =>
      wsSubBoard
        ? { cardId, subBoardId: wsSubBoard.id, title: wsSubBoard.title }
        : null,
    [wsSubBoard, cardId],
  );

  const attached = boardAttached ?? wsAttached;
  const [busy, setBusy] = useState(false);
  const promote = useCallback(() => {
    if ((!boardStore && !wsStore) || attached || busy) return;
    setBusy(true);
    promoteCardToSubboard({ cardId })
      .then((board) => {
        boardStore?.getState().upsertCardSubboard({
          cardId,
          subBoardId: board.id,
          title: board.title,
        });
        wsStore?.getState().upsertSubBoard({
          id: board.id,
          title: board.title,
          parentCardId: cardId,
        });
        toast.success("Sub-board created");
      })
      .catch((err) => {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Sub-board create failed: ${m}` });
      })
      .finally(() => setBusy(false));
  }, [boardStore, wsStore, attached, busy, cardId]);

  const detach = useCallback(
    async ({ alsoDelete }: { alsoDelete?: boolean } = {}) => {
      if ((!boardStore && !wsStore) || !attached || busy) return;
      setBusy(true);
      const subBoardId = attached.subBoardId;
      const subBoardTitle = attached.title;
      try {
        await detachCardSubboard({ cardId });
        boardStore?.getState().removeCardSubboard(cardId);
        if (alsoDelete) {
          try {
            await deleteBoard({ id: subBoardId });
            wsStore?.getState().removeSubBoard(subBoardId);
            toast.success("Sub-board detached + deleted");
          } catch (err) {
            const m = (err as Error).message;
            toast.error("Detached, but delete failed: " + m);
            errorBus.push({ message: `Sub-board delete failed: ${m}` });
            // Leave orphan record in ws store with parent_card_id=null.
            wsStore?.getState().upsertSubBoard({
              id: subBoardId,
              title: subBoardTitle,
              parentCardId: null,
            });
          }
        } else {
          wsStore?.getState().upsertSubBoard({
            id: subBoardId,
            title: subBoardTitle,
            parentCardId: null,
          });
          toast.success("Sub-board detached");
        }
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Sub-board detach failed: ${m}` });
      } finally {
        setBusy(false);
      }
    },
    [boardStore, wsStore, attached, busy, cardId],
  );

  if (!boardStore && !wsStore) return null;
  return { attached, promote, detach, busy };
}

/**
 * Open link for an attached sub-board. The Promote action moved into the
 * TYPE picker — clicking the SUB-BOARD chip there creates the child board.
 * This section now only surfaces the navigation affordance when a card
 * already has one attached.
 */
function QuickViewSubboardSection({ cardId }: { cardId: string }) {
  const ctx = useQuickViewSubboardContext(cardId);
  if (!ctx?.attached) return null;
  return (
    <div
      data-testid="card-quick-view-subboard-open"
      className="flex items-center gap-2 rounded-md border border-hairline px-2 py-1.5 text-xs"
    >
      <FolderKanban className="size-3.5 text-violet-300" aria-hidden />
      <span className="mono-meta-sm text-violet-300">SUB-BOARD</span>
      <span className="mono-meta-sm text-fg-faint">·</span>
      <Link
        href={`/b/${ctx.attached.subBoardId}`}
        className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] text-fg hover:text-fg"
      >
        {ctx.attached.title}
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
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
