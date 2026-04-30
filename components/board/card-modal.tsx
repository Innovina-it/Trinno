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
import { MembersSection } from "./card/members-section";
import { ChecklistsSection } from "./card/checklists-section";
import { AttachmentsSection } from "./card/attachments-section";
import { CommentsSection } from "./card/comments-section";
import { cardCode } from "@/lib/format";

export type CardModalCard = {
  id: string;
  title: string;
  description: string | null;
};

export function CardModal({
  card,
  asDialog = false,
  children,
}: {
  card: CardModalCard;
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

  const body = (
    <div className="space-y-7">
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
      <DueSection cardId={card.id} />
      <MembersSection cardId={card.id} />
      <ChecklistsSection cardId={card.id} />
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

