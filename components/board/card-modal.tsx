"use client";
import { useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateCard, archiveCard } from "@/actions/cards";
import { undoBus } from "@/lib/undo-bus";
import { LabelsSection } from "./card/labels-section";
import { DueSection } from "./card/due-section";
import { RoadmapDatesSection } from "./card/roadmap-dates-section";
import { MembersSection } from "./card/members-section";
import { ChecklistsSection } from "./card/checklists-section";
import { AttachmentsSection } from "./card/attachments-section";
import { CommentsSection } from "./card/comments-section";
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
import { Archive, CalendarRange, Move } from "lucide-react";
import { MoveToBoardDialog } from "./card/move-to-board-dialog";

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
};

export function CardModal({
  card,
  sprints = [],
  workspaceId,
  asDialog = false,
  children,
}: {
  card: CardModalCard;
  sprints?: SprintLite[];
  workspaceId?: string;
  asDialog?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [pending, start] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDesc = useRef(card.description ?? "");
  const lastSavedTitle = useRef(card.title);

  useEffect(() => {
    return () => {
      if (descTimer.current) clearTimeout(descTimer.current);
    };
  }, []);

  // Plan #16b-γ-D (#7) — `[`/`]` navigate to prev/next sibling card in
  // the same list, sorted by position. Skip when the user is typing in
  // an input, textarea, or contentEditable so renaming the title doesn't
  // teleport them to another card. We read sibling order from the board
  // store (always available because both card routes nest under
  // BoardLayout's BoardStoreProvider). Use `router.replace` so [/] doesn't
  // pile up history entries. Select the raw cards array so the zustand
  // selector returns a stable reference; derive the filtered+sorted
  // sibling list inside useMemo to keep React 19 happy.
  const boardStore = useContext(BoardStoreContext);
  const allCards = useStore(boardStore!, (s) => s.cards);
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
        router.replace(`/b/${card.boardId}/c/${siblingNav.prev}`, { scroll: false });
      } else if (e.key === "]" && siblingNav.next) {
        e.preventDefault();
        router.replace(`/b/${card.boardId}/c/${siblingNav.next}`, { scroll: false });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, card.boardId, siblingNav.prev, siblingNav.next]);

  function close() {
    router.back();
  }

  // Plan #16b-γ-D (#10) — archive with undo. Closes the modal first
  // (the card vanishes from the board snapshot via realtime/refresh).
  function onArchive() {
    start(async () => {
      try {
        await archiveCard({ id: card.id, archived: true });
        // Push the undo banner; close the modal so the user sees it.
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
    if (!trimmed || trimmed === lastSavedTitle.current) return;
    lastSavedTitle.current = trimmed;
    const retry = async () => {
      await updateCard({ id: card.id, title: trimmed });
    };
    start(async () => {
      try {
        await retry();
      } catch (err) {
        const msg = (err as Error).message;
        toast.error(msg);
        errorBus.push({
          message: `Title save failed: ${msg}`,
          retry,
        });
      }
    });
  }

  function scheduleDescSave(next: string) {
    setDescription(next);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => {
      if (next === lastSavedDesc.current) return;
      lastSavedDesc.current = next;
      const retry = async () => {
        await updateCard({
          id: card.id,
          description: next.length === 0 ? null : next,
        });
      };
      start(async () => {
        try {
          await retry();
        } catch (err) {
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

  const hasRoadmapDates = Boolean(card.startDate || card.targetDate);
  const showRoadmapLink = Boolean(workspaceId && hasRoadmapDates);

  const body = (
    <div className="space-y-7">
      {/* Cover (color or image) — at the very top above the type row */}
      <CoverPicker
        cardId={card.id}
        coverKind={card.coverKind ?? "none"}
        coverValue={card.coverValue ?? null}
      />

      {/* Type + Priority + Parent + Sprint row — at the very top */}
      {(card.type !== undefined || card.boardId) && (
        <div className="flex flex-wrap items-center gap-2">
          <TypePicker
            cardId={card.id}
            type={card.type ?? "task"}
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
          />
          <WatchToggle cardId={card.id} />
          {showRoadmapLink && (
            <Link
              href={`/w/${workspaceId}/roadmap?focus=${card.id}`}
              data-testid="card-modal-roadmap-link"
              className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
            >
              <CalendarRange className="size-3" />
              VIEW ON ROADMAP →
            </Link>
          )}
        </div>
      )}

      {/* Title — editable, serif italic, large editorial display, gradient on focus */}
      <div className="space-y-2">
        <Label htmlFor="card-title">Title</Label>
        <input
          id="card-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={persistTitle}
          required
          minLength={1}
          maxLength={120}
          className="w-full bg-transparent serif-display text-3xl md:text-4xl text-fg leading-tight border-b border-hairline pb-2 outline-none focus:border-[color:var(--accent-cyan)]/60 focus:gradient-text-static transition-colors"
        />
      </div>

      {/* Description — section heading + glass textarea */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between border-b border-hairline pb-1.5">
          <div className="flex items-center gap-2">
            <span aria-hidden className="block w-0.5 h-4 accent-bar-cyan rounded-full" />
            <h3 className="mono-meta text-fg">Notes</h3>
          </div>
          <span className="mono-meta-sm text-fg-faint">DESCRIPTION</span>
        </div>
        <textarea
          id="card-description"
          value={description}
          onChange={(e) => scheduleDescSave(e.target.value)}
          rows={5}
          className="w-full rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm font-sans text-fg outline-none transition-all duration-200 hover:border-[color:var(--hairline-hi)] focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)] focus-visible:shadow-[0_0_0_3px_rgb(0_229_255/0.20)] placeholder:font-serif placeholder:italic placeholder:text-fg-faint"
          placeholder="Notes…"
        />
      </section>

      <LabelsSection cardId={card.id} />
      <ComponentCardSection cardId={card.id} />
      {workspaceId && (
        <VersionCardSection cardId={card.id} workspaceId={workspaceId} />
      )}
      <DueSection cardId={card.id} />
      <RoadmapDatesSection cardId={card.id} />
      <StoryPointsPicker cardId={card.id} storyPoints={card.storyPoints ?? null} />
      <TimeSection
        cardId={card.id}
        estimateMin={card.estimateMin ?? null}
        spentMin={card.spentMin ?? 0}
      />
      <MembersSection cardId={card.id} />
      <ChecklistsSection cardId={card.id} />
      {card.listId && card.boardId && (
        <SubtasksSection cardId={card.id} listId={card.listId} boardId={card.boardId} />
      )}
      {card.boardId && (
        <CardLinksSection cardId={card.id} boardId={card.boardId} />
      )}
      <AttachmentsSection cardId={card.id} />
      <CommentsSection cardId={card.id} />

      {children && <div className="border-t border-hairline pt-4">{children}</div>}

      <div className="flex justify-between gap-2 border-t border-hairline pt-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onArchive}
            disabled={pending}
            data-testid="card-modal-archive"
          >
            <Archive className="size-3.5 mr-1.5" />
            Archive
          </Button>
          {card.boardId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMoveOpen(true)}
              disabled={pending}
              data-testid="card-modal-move-to-board"
            >
              <Move className="size-3.5 mr-1.5" />
              Move to…
            </Button>
          )}
        </div>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
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
        <div className="glass-strong rounded-3xl p-8">
          <div className="mb-5 flex items-baseline justify-between border-b border-hairline pb-3">
            <span className="chip">CARD</span>
            <span className="mono-meta text-fg-muted">#{cardCode(card.id)}</span>
          </div>
          <h1 className="serif-display gradient-text text-4xl mb-6">{card.title}</h1>
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
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-2">
            <DialogTitle className="serif-display gradient-text text-3xl leading-none">
              Card.
            </DialogTitle>
            <span className="chip">#{cardCode(card.id)}</span>
          </div>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

