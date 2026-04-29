"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";

export function AddCardForm({ listId }: { listId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const addCard = useBoardStore((s) => s.addCard);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    start(async () => {
      try {
        const card = await createCard({ listId, title: trimmed });
        addCard(card);
        setTitle("");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/addcard w-full border border-dashed border-ink/30 bg-transparent px-2 py-1.5 text-left mono-meta-sm text-ink/55 transition-colors duration-150 ease-out hover:border-ink hover:bg-paper-shadow hover:text-ink"
      >
        <Plus className="mr-1 inline-block size-3 align-text-bottom text-ink/40 transition-colors group-hover/addcard:text-signal" />
        + Add a card
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Card title"
        required
        minLength={1}
        maxLength={120}
        className="bg-paper"
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
