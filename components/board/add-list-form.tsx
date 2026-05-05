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
        className="group/add w-80 shrink-0 rounded-2xl border border-dashed border-[color:var(--hairline-hi)] bg-[color:var(--surface)]/60 backdrop-blur-md px-4 py-4 text-left mono-meta text-fg-muted transition-all duration-200 ease-out hover:border-[color:var(--hairline-hi)] hover:bg-[color:var(--surface-strong)] hover:text-fg"
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-fg text-bg-deep">
            <Plus className="size-3" strokeWidth={3} />
          </span>
          + Add a list
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-80 shrink-0 space-y-2.5 rounded-2xl glass-strong p-4 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200"
    >
      <div className="mono-meta-sm text-fg-muted">NEW LIST</div>
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="List title"
        required
        minLength={1}
        maxLength={120}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add list
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
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
