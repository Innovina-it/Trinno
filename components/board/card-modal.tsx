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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateCard } from "@/actions/cards";
import { LabelsSection } from "./card/labels-section";
import { DueSection } from "./card/due-section";
import { CommentsSection } from "./card/comments-section";

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
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="card-title">Title</Label>
        <Input
          id="card-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={persistTitle}
          required
          minLength={1}
          maxLength={120}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="card-description">Description</Label>
        <textarea
          id="card-description"
          value={description}
          onChange={(e) => scheduleDescSave(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Add a more detailed description..."
        />
      </div>

      <LabelsSection cardId={card.id} />
      <DueSection cardId={card.id} />
      <CommentsSection cardId={card.id} />

      {children}

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Close
        </Button>
      </div>
    </div>
  );

  if (!asDialog) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-xl font-semibold">{card.title}</h1>
        {body}
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
          <DialogTitle>Card</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
