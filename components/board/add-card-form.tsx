"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
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
        className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-white/70 transition-colors duration-150 ease-out hover:bg-white/10 hover:text-white"
      >
        + Add a card
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Card title"
        required
        minLength={1}
        maxLength={120}
        className="bg-white text-foreground shadow-sm"
      />
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-white/80 hover:bg-white/10 hover:text-white"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </form>
  );
}
