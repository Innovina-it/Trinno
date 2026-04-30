"use client";
import { useState, useTransition, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import { TypeIcon } from "./type-picker";
import { Link2, X, Search } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export function ParentPicker({
  cardId, parentCardId, boardId,
}: { cardId: string; parentCardId: string | null; boardId: string }) {
  const cards = useBoardStore((s) => s.cards);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const parent = parentCardId ? cards.find((c) => c.id === parentCardId) : null;

  const candidates = useMemo(() => {
    return cards
      .filter((c) => c.id !== cardId && !c.archived)
      .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 30);
  }, [cards, cardId, q]);

  function setParent(nextId: string | null) {
    const prev = parentCardId;
    updateCardLocal(cardId, { parentCardId: nextId });
    start(async () => {
      try { await updateCard({ id: cardId, parentCardId: nextId }); setOpen(false); }
      catch (err) {
        updateCardLocal(cardId, { parentCardId: prev });
        toast.error((err as Error).message);
      }
    });
  }

  if (parent) {
    return (
      <div className="inline-flex items-center gap-2">
        <Link
          href={`/b/${boardId}/c/${parent.id}`}
          className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] transition-colors max-w-[16rem] truncate"
          title={parent.title}
        >
          <TypeIcon type={(parent as { type?: string }).type ?? "task"} />
          <span className="truncate">{parent.title}</span>
        </Link>
        <Button
          type="button" variant="ghost" size="xs"
          onClick={() => setParent(null)}
          disabled={pending}
          aria-label="Clear parent"
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button" variant="ghost" size="xs"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Link2 className="size-3.5" /> SET PARENT
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick parent card</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search cards on this board…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-hairline">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setParent(c.id)}
                    disabled={pending}
                    className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                  >
                    <TypeIcon type={(c as { type?: string }).type ?? "task"} />
                    <span className="text-sm truncate">{c.title}</span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="px-2 py-4 text-sm text-fg-muted text-center">No matches.</li>
              )}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
