"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createList } from "@/actions/lists";
import { useBoardStore } from "@/stores/board-store";

export function AddListForm({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const addList = useBoardStore((s) => s.addList);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    start(async () => {
      try {
        const list = await createList({ boardId, title: trimmed });
        addList(list);
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
        className="group/add w-72 shrink-0 border border-dashed border-ink/40 bg-paper/50 px-3 py-3 text-left mono-meta text-ink/55 transition-colors duration-150 ease-out hover:border-ink hover:bg-paper hover:text-ink"
      >
        <Plus className="mr-1.5 inline-block size-3 align-text-bottom text-ink/40 transition-colors group-hover/add:text-signal" />
        + Add a list
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-72 shrink-0 space-y-2 border border-ink bg-paper p-3 animate-in fade-in slide-in-from-bottom-1 duration-150"
    >
      <div className="mono-meta-sm text-ink/45 mb-1">NEW LIST</div>
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="List title"
        required
        minLength={1}
        maxLength={120}
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add list
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
