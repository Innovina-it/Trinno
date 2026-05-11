"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Plus, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function AddCardForm({ listId }: { listId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [withDates, setWithDates] = useState(false);
  const [start, setStart] = useState("");
  const [target, setTarget] = useState("");
  const [pending, startTx] = useTransition();
  const addCard = useBoardStore((s) => s.addCard);

  function reset() {
    setTitle("");
    setWithDates(false);
    setStart("");
    setTarget("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // Both dates required to land on roadmap; one without the other is
    // ambiguous, so reject early instead of silently dropping.
    if (withDates && (!start || !target)) {
      toast.error("Set both start and target, or skip dates");
      return;
    }
    if (withDates && start > target) {
      toast.error("Start must be on or before target");
      return;
    }
    startTx(async () => {
      try {
        const card = await createCard({
          listId,
          title: trimmed,
          startDate: withDates ? new Date(start + "T00:00:00.000Z") : null,
          targetDate: withDates ? new Date(target + "T00:00:00.000Z") : null,
        });
        addCard(card);
        reset();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function quickWeek() {
    const today = new Date();
    const wk = new Date(today.getTime() + 7 * 86_400_000);
    setStart(toIsoDay(today));
    setTarget(toIsoDay(wk));
    setWithDates(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/addcard w-full rounded-xl border border-dashed border-[color:var(--hairline-hi)] bg-[color:var(--surface)]/50 backdrop-blur-md px-2.5 py-2 text-left mono-meta-sm text-fg-muted transition-all duration-200 ease-out hover:border-[color:var(--accent-cyan)]/60 hover:bg-[color:var(--surface-strong)] hover:text-fg"
      >
        <Plus className="mr-1 inline-block size-3 align-text-bottom text-fg-faint transition-colors group-hover/addcard:text-[color:var(--accent-cyan)]" />
        + Add a card
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-150"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Card title"
        required
        minLength={1}
        maxLength={120}
      />
      {withDates ? (
        <div className="space-y-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2">
          <div className="flex items-center justify-between">
            <span className="mono-meta-sm text-fg-faint">DATES (LANDS ON ROADMAP)</span>
            <button
              type="button"
              onClick={() => setWithDates(false)}
              className="mono-meta-sm text-fg-faint hover:text-fg"
            >
              skip
            </button>
          </div>
          <div className="flex gap-1.5">
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-label="Start date"
              data-testid="add-card-start"
              className="text-xs"
            />
            <Input
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Target date"
              data-testid="add-card-target"
              className="text-xs"
            />
          </div>
          <button
            type="button"
            onClick={quickWeek}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            Today + 7 days
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWithDates(true)}
          className="inline-flex items-center gap-1.5 mono-meta-sm text-fg-faint hover:text-fg"
          data-testid="add-card-dates-toggle"
        >
          <CalendarRange className="size-3" />
          Add to roadmap (optional)
        </button>
      )}
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
            reset();
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
