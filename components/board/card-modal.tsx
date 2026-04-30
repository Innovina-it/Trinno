"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateCard } from "@/actions/cards";
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
import { CalendarRange } from "lucide-react";

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
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDesc = useRef(card.description ?? "");
  const lastSavedTitle = useRef(card.title);

  useEffect(() => {
    return () => {
      if (descTimer.current) clearTimeout(descTimer.current);
    };
  }, []);

  function close() {
    router.back();
  }

  function persistTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === lastSavedTitle.current) return;
    lastSavedTitle.current = trimmed;
    start(async () => {
      try {
        await updateCard({ id: card.id, title: trimmed });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function scheduleDescSave(next: string) {
    setDescription(next);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => {
      if (next === lastSavedDesc.current) return;
      lastSavedDesc.current = next;
      start(async () => {
        try {
          await updateCard({
            id: card.id,
            description: next.length === 0 ? null : next,
          });
        } catch (err) {
          toast.error((err as Error).message);
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

      <div className="flex justify-end border-t border-hairline pt-4">
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Close
        </Button>
      </div>
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

