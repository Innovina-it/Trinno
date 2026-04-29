"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
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
        className="w-72 shrink-0 rounded-md bg-white/10 px-3 py-2 text-left text-sm text-white hover:bg-white/20"
      >
        + Add a list
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-72 shrink-0 space-y-2 rounded-md bg-white p-2"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="List title"
        required
        minLength={1}
        maxLength={120}
      />
      <div className="flex gap-1">
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
          <X className="size-4" />
        </Button>
      </div>
    </form>
  );
}
