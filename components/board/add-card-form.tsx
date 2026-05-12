"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Plus, CalendarRange, CalendarClock, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCard, updateCard } from "@/actions/cards";
import { toggleCardMember } from "@/actions/card-members";
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
  // Task 5 — parity with edit-card. Creators can set a due date and
  // pre-assign members up front so the card lands on the board with the
  // same minimum metadata the edit modal surfaces.
  const [due, setDue] = useState("");
  const [assignees, setAssignees] = useState<Set<string>>(() => new Set());
  const [pending, startTx] = useTransition();
  const addCard = useBoardStore((s) => s.addCard);
  const addCardMember = useBoardStore((s) => s.addCardMember);
  const boardProfiles = useBoardStore((s) => s.boardProfiles);

  function reset() {
    setTitle("");
    setWithDates(false);
    setStart("");
    setTarget("");
    setDue("");
    setAssignees(new Set());
  }

  function toggleAssignee(userId: string) {
    setAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
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
        // Post-create patches — due date is on `cards`, member assignments
        // live on `card_members`. Fire-and-forget per assignee so the
        // form closes promptly; per-call errors surface as toasts but the
        // card itself is already saved.
        if (due) {
          try {
            await updateCard({
              id: card.id,
              dueDate: new Date(due + "T00:00:00.000Z"),
            });
          } catch (err) {
            toast.error("Saved card, but due date failed: " + (err as Error).message);
          }
        }
        for (const userId of assignees) {
          try {
            await toggleCardMember({ cardId: card.id, userId });
            addCardMember({ cardId: card.id, userId });
          } catch (err) {
            toast.error("Saved card, but assignee failed: " + (err as Error).message);
          }
        }
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
      data-testid="add-card-form"
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

      {/* Task 5 — assignee row: minimal chips of board profiles. Stays
          collapsed inside the form; never blocks card creation when the
          board has no other members. */}
      {boardProfiles.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2">
          <div className="flex items-center gap-1.5">
            <Users className="size-3 text-fg-faint" aria-hidden />
            <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
            {assignees.size > 0 && (
              <span className="mono-meta-sm text-fg-muted tabular-nums">
                ({assignees.size})
              </span>
            )}
          </div>
          <ul className="flex flex-wrap gap-1">
            {boardProfiles.map((p) => {
              const on = assignees.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggleAssignee(p.id)}
                    aria-pressed={on}
                    data-user-id={p.id}
                    data-assigned={on}
                    data-testid="add-card-member"
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                      on
                        ? "border-fg/40 bg-fg/10 text-fg"
                        : "border-hairline bg-transparent text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)]",
                    ].join(" ")}
                  >
                    <Avatar
                      size="sm"
                      className="rounded-none border border-current size-4"
                    >
                      <AvatarFallback className="rounded-none bg-transparent text-current text-[9px] tracking-widest">
                        {p.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="normal-case tracking-normal">
                      {p.displayName}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Due date — single field, separate from the roadmap span. Optional;
          empty input persists null. */}
      <label
        className="flex items-center gap-1.5 rounded-md border border-hairline bg-[color:var(--surface)] p-2"
        data-testid="add-card-due-row"
      >
        <CalendarClock className="size-3 text-fg-faint" aria-hidden />
        <span className="mono-meta-sm text-fg-faint">DUE</span>
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          data-testid="add-card-due"
          className="text-xs ml-auto w-[10rem]"
        />
      </label>

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
