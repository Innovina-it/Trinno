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
      {/* Title — editable, serif italic, large editorial display */}
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
          className="w-full bg-transparent serif-display text-3xl md:text-4xl text-ink leading-tight border-b border-rule pb-2 outline-none focus:border-ink transition-colors"
        />
      </div>

      {/* Description — section heading + textarea with serif italic placeholder */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between border-b border-rule pb-1">
          <h3 className="mono-meta text-ink/70">Notes</h3>
          <span className="mono-meta-sm text-ink/35">DESCRIPTION</span>
        </div>
        <textarea
          id="card-description"
          value={description}
          onChange={(e) => scheduleDescSave(e.target.value)}
          rows={5}
          className="w-full rounded-none border border-rule bg-paper-shadow p-3 text-sm font-sans outline-none transition-colors focus-visible:border-ink focus-visible:bg-paper placeholder:font-serif placeholder:italic placeholder:text-ink/40"
          placeholder="Notes…"
        />
      </section>

      <LabelsSection cardId={card.id} />
      <DueSection cardId={card.id} />
      <MembersSection cardId={card.id} />
      <ChecklistsSection cardId={card.id} />
      <AttachmentsSection cardId={card.id} />
      <CommentsSection cardId={card.id} />

      {children && <div className="border-t border-rule pt-4">{children}</div>}

      <div className="flex justify-end border-t border-rule pt-4">
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Close
        </Button>
      </div>
    </div>
  );

  if (!asDialog) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="border border-ink bg-paper p-6">
          <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2">
            <span className="mono-meta text-ink/55">CARD</span>
            <span className="mono-meta text-ink/55">#{cardCode(card.id)}</span>
          </div>
          <h1 className="serif-display text-4xl text-ink mb-6">{card.title}</h1>
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-2">
            <DialogTitle className="serif-display text-2xl text-ink leading-none">
              Card.
            </DialogTitle>
            <span className="mono-meta text-ink/55">#{cardCode(card.id)}</span>
          </div>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

