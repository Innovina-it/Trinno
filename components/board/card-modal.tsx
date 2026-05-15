"use client";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { toast } from "sonner";
import { errorBus } from "@/lib/errors/error-bus";
import { BoardStoreContext } from "@/stores/board-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { updateCard, archiveCard } from "@/actions/cards";
import { toggleCardMember } from "@/actions/card-members";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { undoBus } from "@/lib/undo-bus";
import { DatePicker } from "@/components/ui/date-picker";
import { LabelsSection } from "./card/labels-section";
import { DueSection } from "./card/due-section";
import { RoadmapDatesSection } from "./card/roadmap-dates-section";
import { MembersSection } from "./card/members-section";
import { OwnerSection } from "./card/owner-section";
import { ChecklistsSection } from "./card/checklists-section";
import { AttachmentsSection } from "./card/attachments-section";
import { TypePicker } from "./card/type-picker";
import { PriorityPicker, type CardPriority } from "./card/priority-picker";
import { CoverPicker, type CoverKind } from "./card/cover-picker";
import { ParentPicker } from "./card/parent-picker";
import { WatchToggle } from "./card/watch-toggle";
import { SubtasksSection } from "./card/subtasks-section";
import { CardLinksSection } from "./card/card-links-section";
import { SprintPicker, type SprintLite } from "@/components/sprint/sprint-picker";
import { StoryPointsPicker } from "./card/story-points-picker";
import { TimeSection } from "./card/time-section";
import { ComponentCardSection } from "@/components/components/component-card-section";
import { VersionCardSection } from "@/components/versions/version-card-section";
import { cardCode } from "@/lib/format";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  CalendarRange,
  Check,
  ChevronRight,
  History,
  MoreHorizontal,
  Move,
} from "lucide-react";
import { MoveToBoardDialog } from "./card/move-to-board-dialog";
import { MarkdownView } from "@/components/markdown";
import {
  useCardHistoryPaginated,
  type CardHistoryRow,
} from "@/lib/queries/use-card-history";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";
import { consumeRoadmapCardOrigin } from "@/lib/roadmap/back-nav";

export type CardModalCard = {
  id: string;
  title: string;
  description: string | null;
  type?: string;
  parentCardId?: string | null;
  listId?: string;
  boardId?: string;
  sprintId?: string | null;
  storyPoints?: number | null;
  estimateMin?: number | null;
  spentMin?: number | null;
  startDate?: Date | string | null;
  targetDate?: Date | string | null;
  priority?: CardPriority | null;
  coverKind?: CoverKind;
  coverValue?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean;
  completedAt?: Date | string | null;
};

function fmtSavedAt(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AccordionGroup({
  id,
  title,
  count,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => onOpenChange?.(e.currentTarget.open)}
      data-testid={`card-modal-group-${id}`}
      className="group/acc rounded-xl border border-hairline bg-[color:var(--surface)] open:bg-[color:var(--surface-strong)] transition-colors"
    >
      <summary className="flex items-center gap-2 px-3 py-3 cursor-pointer select-none list-none rounded-xl hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 text-fg-faint shrink-0 transition-transform group-open/acc:rotate-90"
        />
        <span className="font-sans text-sm font-medium text-fg flex-1">
          {title}
        </span>
        {typeof count === "number" && count > 0 && (
          <span className="mono-meta-sm text-fg-faint tabular-nums">
            {count}
          </span>
        )}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-4">{children}</div>
    </details>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  priority: "Priority",
  owner_id: "Owner",
  start_date: "Start date",
  target_date: "Target date",
  due_date: "Due date",
  completed_at: "Completion",
  sprint_id: "Sprint",
  parent_card_id: "Parent",
  type: "Type",
  story_points: "Story points",
  estimate_min: "Estimate (min)",
};

function fmtHistoryDate(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function shortHistoryValue(v: string | null): string {
  if (!v) return "-";
  return v.length > 12 ? `...${v.slice(-6)}` : v;
}

function fmtHistoryValue(field: string, v: string | null): string {
  if (v === null || v === "") return "-";
  if (
    field === "owner_id" ||
    field === "parent_card_id" ||
    field === "sprint_id"
  ) {
    return shortHistoryValue(v);
  }
  if (
    field === "start_date" ||
    field === "target_date" ||
    field === "due_date" ||
    field === "completed_at"
  ) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
  }
  return v.length > 40 ? `${v.slice(0, 40)}...` : v;
}

function CardHistoryPanel({
  cardId,
  enabled,
}: {
  cardId: string;
  enabled: boolean;
}) {
  const { rows, loading, error, hasMore, loadNextPage } =
    useCardHistoryPaginated(cardId, 20, enabled);

  return (
    <section className="space-y-3" data-testid="history-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted inline-flex items-center gap-1.5">
          <History className="size-3" aria-hidden />
          History
        </h3>
        {loading ? (
          <span className="mono-meta-sm text-fg-faint">LOADING...</span>
        ) : (
          <span className="mono-meta-sm text-fg-faint tabular-nums">
            {rows.length} {rows.length === 1 ? "EVENT" : "EVENTS"}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-[color:var(--accent-magenta)]">
          Failed to load: {error}
        </p>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="mono-meta-sm text-fg-faint">NO CHANGES YET</p>
      )}

      {rows.length > 0 && (
        <ol className="space-y-1.5" data-testid="history-list">
          {rows.map((r: CardHistoryRow) => (
            <li
              key={`${r.kind}:${r.id}`}
              className="flex items-baseline gap-2 text-xs leading-snug"
              data-testid="history-row"
              data-kind={r.kind}
            >
              <span
                className="mono-meta-sm text-fg-faint w-20 shrink-0 tabular-nums"
                title={r.at.toISOString()}
              >
                {fmtHistoryDate(r.at)}
              </span>
              {r.kind === "field" ? (
                <>
                  <span className="text-fg-muted shrink-0">
                    {FIELD_LABEL[r.field] ?? r.field}
                  </span>
                  <span className="text-fg-faint">
                    {fmtHistoryValue(r.field, r.oldValue)}
                  </span>
                  <ArrowRight className="size-3 text-fg-faint shrink-0" />
                  <span className="text-fg">
                    {fmtHistoryValue(r.field, r.newValue)}
                  </span>
                  {r.actorName && (
                    <span className="ml-auto mono-meta-sm text-fg-faint truncate">
                      by {r.actorName}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-fg-muted shrink-0">Sprint</span>
                  <span className="text-fg">{r.sprintName ?? "Backlog"}</span>
                  <span className="mono-meta-sm text-fg-faint">
                    {r.removedAt ? "left" : "active"}
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadNextPage}
          disabled={loading}
          data-testid="history-load-more"
        >
          Load more
        </Button>
      )}
    </section>
  );
}

function toUtcMidnight(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/**
 * Task 5 — Quick-edit strip surfaced in the card-modal header so the
 * three minimum-set fields (title, members, due date) are always reachable
 * without scrolling into the Planning / Work accordions. Title lives in
 * the hero just above; this strip handles members + due date inline.
 *
 * Optimistic local writes mirror the dedicated DueSection / MembersSection
 * patterns; we don't reuse those components verbatim because they render
 * full panels with helper copy, which would defeat the "visible without
 * scrolling" goal of the quick-edit strip.
 */
function QuickEditStrip({
  cardId,
  currentDueDate,
}: {
  cardId: string;
  currentDueDate: Date | string | null;
}) {
  const boardStore = useContext(BoardStoreContext);
  const profiles = useStore(boardStore!, (s) => s.boardProfiles);
  const cardMembers = useStore(boardStore!, (s) => s.cardMembers);
  const addCardMember = useStore(boardStore!, (s) => s.addCardMember);
  const removeCardMember = useStore(boardStore!, (s) => s.removeCardMember);
  const updateCardLocal = useStore(boardStore!, (s) => s.updateCard);
  // Live card view so optimistic dueDate writes (and external realtime
  // updates) propagate without remounting the modal.
  const liveDue = useStore(boardStore!, (s) => {
    const c = s.cards.find((c) => c.id === cardId);
    return c?.dueDate ?? null;
  });
  const [pending, start] = useTransition();

  const assigned = new Set(
    cardMembers.filter((m) => m.cardId === cardId).map((m) => m.userId),
  );
  const due = toUtcMidnight(liveDue ?? currentDueDate);

  function toggle(userId: string) {
    const wasAssigned = assigned.has(userId);
    if (wasAssigned) removeCardMember(cardId, userId);
    else addCardMember({ cardId, userId });
    start(async () => {
      try {
        await toggleCardMember({ cardId, userId });
      } catch (err) {
        // Roll back optimistic state on failure.
        if (wasAssigned) addCardMember({ cardId, userId });
        else removeCardMember(cardId, userId);
        toast.error((err as Error).message);
      }
    });
  }

  function setDue(next: Date | null) {
    // Persist as noon UTC so the date doesn't shift across time zones — matches DueSection.
    const dueDate = next
      ? new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 12))
      : null;
    const patch = dueDate
      ? { dueDate }
      : { dueDate: null, dueComplete: false };
    updateCardLocal(cardId, patch);
    start(async () => {
      try {
        await updateCard({ id: cardId, ...patch });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (profiles.length === 0) {
    // No collaborators to show — just surface due date inline.
    return (
      <section
        data-testid="card-modal-quick-edit"
        className="flex items-center gap-2 rounded-xl border border-hairline bg-[color:var(--surface)] px-3 py-2"
      >
        <span className="mono-meta-sm text-fg-faint">DUE</span>
        <div className="ml-auto" data-testid="card-modal-quick-due">
          <DatePicker
            value={due}
            onChange={setDue}
            disabled={pending}
            triggerLabel="Set due"
            inputLabel="Due date"
          />
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="card-modal-quick-edit"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-[color:var(--surface)] px-3 py-2"
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-[12rem] flex-wrap">
        <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
        {profiles.map((p) => {
          const on = assigned.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              data-user-id={p.id}
              data-assigned={on}
              data-testid="card-modal-quick-member"
              disabled={pending}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                on
                  ? "border-fg/40 bg-fg/10 text-fg"
                  : "border-hairline bg-transparent text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)]",
              ].join(" ")}
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
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="mono-meta-sm text-fg-faint">DUE</span>
        <div data-testid="card-modal-quick-due">
          <DatePicker
            value={due}
            onChange={setDue}
            disabled={pending}
            triggerLabel="Set due"
            inputLabel="Due date"
          />
        </div>
      </div>
    </section>
  );
}

export function CardModal({
  card,
  sprints = [],
  workspaceId,
  canManageSprints = false,
  asDialog = false,
  children,
}: {
  card: CardModalCard;
  sprints?: SprintLite[];
  workspaceId?: string;
  canManageSprints?: boolean;
  asDialog?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [pending, start] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [historyRequested, setHistoryRequested] = useState(false);
  const historySentinelRef = useRef<HTMLDivElement | null>(null);
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDesc = useRef(card.description ?? "");
  const lastSavedTitle = useRef(card.title);
  const lazyHistory = useWorkspaceFlag("lazy_card_history", false);

  useEffect(() => {
    return () => {
      if (descTimer.current) clearTimeout(descTimer.current);
    };
  }, []);

  // Sibling navigation. Same as before.
  const boardStore = useContext(BoardStoreContext);
  const allCards = useStore(boardStore!, (s) => s.cards);
  const liveCard = allCards.find((c) => c.id === card.id) as
    | (typeof allCards)[number]
    | undefined;
  const cardVisible = useStore(boardStore!, (s) =>
    s.cards.some((c) => c.id === card.id),
  );
  const siblingNav = useMemo(() => {
    if (!card.listId || !card.boardId) return { prev: null, next: null };
    const siblings = allCards
      .filter((c) => c.listId === card.listId && !c.archived)
      .slice()
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    if (!siblings.length) return { prev: null, next: null };
    const idx = siblings.findIndex((c) => c.id === card.id);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? siblings[idx - 1].id : null,
      next: idx < siblings.length - 1 ? siblings[idx + 1].id : null,
    };
  }, [allCards, card.id, card.listId, card.boardId]);

  useEffect(() => {
    if (!card.boardId || cardVisible) return;
    toast.info("This card was removed by another user.");
    if (asDialog) router.back();
    else router.replace(`/b/${card.boardId}`);
  }, [asDialog, card.boardId, cardVisible, router]);

  useEffect(() => {
    if (!lazyHistory || historyRequested) return;
    const node = historySentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setHistoryRequested(true);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [historyRequested, lazyHistory]);

  // Stable ref pointing at the current `handleToggleComplete` so the
  // keydown effect (registered above the function declaration) can call
  // the latest closure without re-binding on every render.
  const toggleRef = useRef<(() => void) | null>(null);
  // Same pattern for `close`, so the Escape handler in the keydown
  // effect doesn't have to depend on the function identity.
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!card.boardId) return;
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === "[" && siblingNav.prev) {
        e.preventDefault();
        router.replace(`/b/${card.boardId}/c/${siblingNav.prev}`, {
          scroll: false,
        });
      } else if (e.key === "]" && siblingNav.next) {
        e.preventDefault();
        router.replace(`/b/${card.boardId}/c/${siblingNav.next}`, {
          scroll: false,
        });
      } else if (e.key === "c") {
        e.preventDefault();
        toggleRef.current?.();
      } else if (e.key === "Escape" && !asDialog) {
        // Full-page modal route: Esc returns to the previous page,
        // honoring the roadmap-origin breadcrumb if present. The
        // asDialog branch already gets Esc handling for free from
        // the Radix Dialog wrapper.
        e.preventDefault();
        closeRef.current?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asDialog, router, card.boardId, siblingNav.prev, siblingNav.next]);

  function close() {
    // Honor the roadmap-origin breadcrumb when present: opens from
    // /w/.../roadmap → quick-view → "Open advanced settings" land here,
    // and Close should return to the roadmap not the underlying board.
    // Falls through to router.back() for the normal /b/.../c/{cardId}
    // flow opened directly from the board.
    const roadmapHref = consumeRoadmapCardOrigin();
    if (roadmapHref) {
      router.replace(roadmapHref, { scroll: false });
      return;
    }
    router.back();
  }

  function onArchive() {
    start(async () => {
      try {
        await archiveCard({ id: card.id, archived: true });
        undoBus.push({
          message: "Card archived",
          undo: async () => {
            try {
              await archiveCard({ id: card.id, archived: false });
            } catch (err) {
              const m = "Failed to undo archive: " + (err as Error).message;
              toast.error(m);
              errorBus.push({ message: m });
            }
          },
        });
        router.back();
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Archive failed: ${m}` });
      }
    });
  }

  function persistTitle() {
    const trimmed = title.trim();
    // Empty title rollback: restore last saved value, do not save empty.
    if (!trimmed) {
      setTitle(lastSavedTitle.current);
      toast.error("Title can't be empty");
      return;
    }
    if (trimmed === lastSavedTitle.current) return;
    const prev = lastSavedTitle.current;
    lastSavedTitle.current = trimmed;
    updateCardLocal(card.id, { title: trimmed });
    const retry = async () => {
      await updateCard({ id: card.id, title: trimmed });
    };
    start(async () => {
      try {
        await retry();
        setLastSavedAt(new Date());
        undoBus.push({
          message: "Title updated",
          undo: async () => {
            setTitle(prev);
            lastSavedTitle.current = prev;
            updateCardLocal(card.id, { title: prev });
            try {
              await updateCard({ id: card.id, title: prev });
            } catch (err) {
              setTitle(trimmed);
              lastSavedTitle.current = trimmed;
              updateCardLocal(card.id, { title: trimmed });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        lastSavedTitle.current = prev;
        updateCardLocal(card.id, { title: prev });
        const msg = (err as Error).message;
        toast.error(msg);
        errorBus.push({ message: `Title save failed: ${msg}`, retry });
      }
    });
  }

  function scheduleDescSave(next: string) {
    setDescription(next);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => {
      if (next === lastSavedDesc.current) return;
      const prev = lastSavedDesc.current;
      lastSavedDesc.current = next;
      updateCardLocal(card.id, { description: next.length === 0 ? null : next });
      const retry = async () => {
        await updateCard({
          id: card.id,
          description: next.length === 0 ? null : next,
        });
      };
      start(async () => {
        try {
          await retry();
          setLastSavedAt(new Date());
          undoBus.push({
            message: next.length === 0 ? "Description cleared" : "Description updated",
            undo: async () => {
              setDescription(prev);
              lastSavedDesc.current = prev;
              updateCardLocal(card.id, {
                description: prev.length === 0 ? null : prev,
              });
              try {
                await updateCard({
                  id: card.id,
                  description: prev.length === 0 ? null : prev,
                });
              } catch (err) {
                setDescription(next);
                lastSavedDesc.current = next;
                updateCardLocal(card.id, {
                  description: next.length === 0 ? null : next,
                });
                toast.error("Undo failed: " + (err as Error).message);
              }
            },
          });
        } catch (err) {
          lastSavedDesc.current = prev;
          updateCardLocal(card.id, {
            description: prev.length === 0 ? null : prev,
          });
          const msg = (err as Error).message;
          toast.error(msg);
          errorBus.push({
            message: `Description save failed: ${msg}`,
            retry,
          });
        }
      });
    }, 600);
  }

  const activeCardType = liveCard?.type ?? card.type ?? "task";
  const hasRoadmapDates = Boolean(card.startDate || card.targetDate);
  const onRoadmap = activeCardType === "story";
  const showRoadmapLink = Boolean(workspaceId && hasRoadmapDates && onRoadmap);
  const knownCardTypes = new Set(["story", "task", "subtask", "bug"]);
  const isLegacySubboardType = Boolean(
    activeCardType && !knownCardTypes.has(activeCardType),
  );

  // Save indicator copy.
  const saveIndicator = pending
    ? "Saving…"
    : lastSavedAt
      ? `Saved · ${fmtSavedAt(lastSavedAt)}`
      : null;

  const updateCardLocal = useStore(boardStore!, (s) => s.updateCard);
  // Live completion state: prefer the store row (kept current via realtime
  // and optimistic updates) so the toggle's visual flips immediately.
  // Fall back to the SSR prop on the standalone card page when the store
  // hasn't hydrated yet.
  const isCompleted =
    (liveCard?.completedAt ??
      (card as { completedAt?: Date | string | null }).completedAt) != null ||
    Boolean(liveCard?.dueComplete ?? card.dueComplete);
  const handleToggleComplete = () => {
    const next = !isCompleted;
    const prevCompletedAt = liveCard?.completedAt ?? card.completedAt ?? null;
    const prev = {
      completedAt:
        prevCompletedAt instanceof Date
          ? prevCompletedAt
          : prevCompletedAt
            ? new Date(prevCompletedAt)
            : null,
      dueComplete: liveCard?.dueComplete ?? card.dueComplete ?? false,
    };
    updateCardLocal(card.id, {
      completedAt: next ? new Date() : null,
      dueComplete: next,
    });
    start(async () => {
      try {
        await updateCard({ id: card.id, completed: next });
        undoBus.push({
          message: next ? "Marked complete" : "Marked not complete",
          undo: async () => {
            updateCardLocal(card.id, prev);
            try {
              await updateCard({
                id: card.id,
                completed: prev.completedAt != null || prev.dueComplete,
              });
            } catch (err) {
              updateCardLocal(card.id, {
                completedAt: next ? new Date() : null,
                dueComplete: next,
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        updateCardLocal(card.id, prev);
        toast.error((err as Error).message);
      }
    });
  };
  toggleRef.current = handleToggleComplete;
  closeRef.current = close;

  const body = (
    <div className="space-y-5">
      {/* Hero block: title + meta + save indicator + overflow actions. */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {/* Prominent complete toggle — visible on every card. Click
              flips `completed_at` (DB trigger keeps `dueComplete` in
              sync). The header position keeps it adjacent to the title
              so the action reads as "mark this card done". */}
          <button
            type="button"
            onClick={handleToggleComplete}
            disabled={pending}
            aria-label={isCompleted ? "Mark not complete" : "Mark complete"}
            aria-pressed={isCompleted}
            data-testid="card-modal-complete-toggle"
            data-completed={isCompleted ? "true" : "false"}
            className={`mt-1 size-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
              isCompleted
                ? "bg-[color:var(--accent-lime)] border-[color:var(--accent-lime)] text-bg-deep"
                : "border-hairline-hi text-transparent hover:border-fg/60 hover:text-fg/40"
            }`}
          >
            <Check className="size-4" strokeWidth={3} />
          </button>
          <input
            id="card-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={persistTitle}
            required
            minLength={1}
            maxLength={120}
            aria-label="Card title"
            data-completed={isCompleted ? "true" : "false"}
            className={`flex-1 min-w-0 bg-transparent font-sans text-2xl md:text-3xl font-bold tracking-tight text-fg leading-tight outline-none focus-visible:ring-1 focus-visible:ring-fg/40 rounded-md px-1 -mx-1 py-0.5 ${
              isCompleted ? "line-through text-fg-muted" : ""
            }`}
          />
          <div className="flex items-center gap-2 shrink-0 pt-2">
            {saveIndicator && (
              <span
                className="mono-meta-sm text-fg-faint tabular-nums"
                data-testid="card-modal-save-indicator"
              >
                {saveIndicator}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More card actions"
                className="size-7 inline-flex items-center justify-center rounded-full border border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Card</DropdownMenuLabel>
                  {card.boardId && (
                    <DropdownMenuItem
                      onSelect={() => setMoveOpen(true)}
                      data-testid="card-modal-move-to-board"
                    >
                      <Move className="size-3.5" aria-hidden />
                      Move to board…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={onArchive}
                    disabled={pending}
                    data-testid="card-modal-archive"
                    className="text-fg-muted"
                  >
                    <Archive className="size-3.5" aria-hidden />
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Meta row: attribute group + state group + nav group. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(card.type !== undefined || card.boardId) && (
            <>
              <TypePicker
                cardId={card.id}
                type={activeCardType}
                parentCardId={card.parentCardId ?? null}
              />
              <PriorityPicker
                cardId={card.id}
                priority={card.priority ?? null}
              />
              {card.boardId && (
                <ParentPicker
                  cardId={card.id}
                  parentCardId={card.parentCardId ?? null}
                  boardId={card.boardId}
                />
              )}
              <SprintPicker
                cardId={card.id}
                sprintId={card.sprintId ?? null}
                sprints={sprints}
                readOnly={!canManageSprints}
              />
              <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
              <WatchToggle cardId={card.id} />
              {showRoadmapLink && (
                <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
              )}
              {showRoadmapLink && (
                <Link
                  href={`/w/${workspaceId}/roadmap?focus=${card.id}`}
                  data-testid="card-modal-roadmap-link"
                  className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
                >
                  <CalendarRange className="size-3" aria-hidden />
                  Roadmap →
                </Link>
              )}
            </>
          )}
        </div>
        {isLegacySubboardType && (
          <div
            data-testid="card-modal-subboard-deprecated"
            className="rounded-xl border border-hairline bg-[color:var(--surface)] px-3 py-2 text-sm text-fg-muted"
          >
            This retired card type has been migrated to a sub-board. Open it
            from the workspace board list.
          </div>
        )}
      </div>

      {/* Task 5 — quick-edit strip. Surfaces the three minimum-set fields
          (title is in the hero above; assignee + due date go here) so the
          operator can flip the dials parity-matched with AddCardForm
          without scrolling into the Planning/Work accordions. */}
      <QuickEditStrip
        cardId={card.id}
        currentDueDate={card.dueDate ?? null}
      />

      {/* Notes — markdown render in view mode, click to edit. Cmd/Ctrl+Enter
          or blur saves. Empty state invites a click. */}
      <section className="space-y-2" data-testid="card-modal-notes">
        {editingNotes ? (
          <textarea
            id="card-description"
            autoFocus
            value={description}
            onChange={(e) => scheduleDescSave(e.target.value)}
            onBlur={() => setEditingNotes(false)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                setEditingNotes(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingNotes(false);
              }
            }}
            rows={4}
            aria-label="Notes"
            placeholder="Notes. Supports # headings, **bold**, *italic*, `code`, [links](url), and `- ` bullets. Cmd/Ctrl+Enter to finish."
            className="w-full rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm font-sans text-fg outline-none transition-colors hover:border-[color:var(--hairline-hi)] focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)] focus-visible:shadow-[0_0_0_3px_rgb(0_229_255/0.20)] placeholder:italic placeholder:text-fg-faint resize-y min-h-24 max-h-[60vh]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
        ) : description.trim() ? (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            data-testid="card-modal-notes-view"
            className="w-full text-left rounded-xl border border-hairline bg-[color:var(--surface)] p-3 hover:bg-[color:var(--surface-strong)] hover:border-[color:var(--hairline-hi)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            <MarkdownView body={description} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            data-testid="card-modal-notes-empty"
            className="w-full rounded-xl border border-dashed border-hairline-hi bg-[color:var(--surface)] p-3 text-left text-sm text-fg-faint italic hover:bg-[color:var(--surface-strong)] hover:text-fg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            Click to add notes. Markdown supported.
          </button>
        )}
      </section>

      {/* Planning */}
      <AccordionGroup id="planning" title="Planning">
        <DueSection cardId={card.id} />
        <RoadmapDatesSection cardId={card.id} />
        <StoryPointsPicker
          cardId={card.id}
          storyPoints={card.storyPoints ?? null}
        />
        <TimeSection
          cardId={card.id}
          estimateMin={card.estimateMin ?? null}
          spentMin={card.spentMin ?? 0}
        />
        {workspaceId && (
          <VersionCardSection cardId={card.id} workspaceId={workspaceId} />
        )}
      </AccordionGroup>

      {/* Work */}
      <AccordionGroup id="work" title="Work">
        <LabelsSection cardId={card.id} />
        <ComponentCardSection cardId={card.id} />
        <OwnerSection cardId={card.id} />
        <MembersSection cardId={card.id} />
        <ChecklistsSection cardId={card.id} />
        {card.listId && card.boardId && (
          <SubtasksSection
            cardId={card.id}
            listId={card.listId}
            boardId={card.boardId}
          />
        )}
      </AccordionGroup>

      {/* Refs */}
      <AccordionGroup id="refs" title="References">
        <CoverPicker
          cardId={card.id}
          coverKind={card.coverKind ?? "none"}
          coverValue={card.coverValue ?? null}
        />
        {card.boardId && (
          <CardLinksSection cardId={card.id} boardId={card.boardId} />
        )}
        <AttachmentsSection cardId={card.id} />
      </AccordionGroup>

      <AccordionGroup
        id="history"
        title="History"
        onOpenChange={(open) => {
          if (open) setHistoryRequested(true);
        }}
      >
        <div
          ref={historySentinelRef}
          data-testid="card-modal-history-lazy-sentinel"
        >
          <CardHistoryPanel
            cardId={card.id}
            enabled={!lazyHistory || historyRequested}
          />
        </div>
      </AccordionGroup>

      {children && (
        <div className="border-t border-hairline pt-4">{children}</div>
      )}

      <div className="flex justify-end gap-2 border-t border-hairline pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={close}
          disabled={pending}
        >
          Close
        </Button>
      </div>
      {card.boardId && (
        <MoveToBoardDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          cardId={card.id}
          currentBoardId={card.boardId}
          currentWorkspaceId={workspaceId}
          cardTitle={card.title}
        />
      )}
    </div>
  );

  if (!asDialog) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-6 shadow-xl">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="mono-meta-sm text-fg-faint">
              CARD · #{cardCode(card.id)}
            </span>
            <Link
              href={card.boardId ? `/b/${card.boardId}` : "/"}
              className="mono-meta-sm text-fg-muted hover:text-fg"
            >
              ← BOARD
            </Link>
          </div>
          {body}
        </div>
      </main>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        className={[
          "sm:max-w-3xl max-h-[90dvh] overflow-y-auto",
          // <md: anchor to the bottom and take the full width so the card
          // feels like a bottom sheet (no need for a separate BottomSheet
          // implementation here — the structure stays a Dialog so card
          // sub-pickers continue to portal correctly).
          "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:translate-x-0 max-md:translate-y-0",
          "max-md:max-w-none max-md:w-full max-md:max-h-[92dvh] max-md:rounded-t-2xl max-md:rounded-b-none",
          "max-md:slide-in-from-bottom-12 max-md:zoom-in-100",
          "max-md:pb-[max(env(safe-area-inset-bottom),0.5rem)]",
        ].join(" ")}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Card #{cardCode(card.id)}</DialogTitle>
        </DialogHeader>
        <div className="-mt-2 mb-1 flex items-baseline justify-between">
          <span className="mono-meta-sm text-fg-faint">
            CARD · #{cardCode(card.id)}
          </span>
        </div>
        {body}
      </DialogContent>
    </Dialog>
  );
}
