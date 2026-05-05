"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateGadget } from "@/actions/gadgets";
import { toast } from "sonner";

type GadgetSize = "1x1" | "2x1" | "2x2" | "3x1" | "3x2";

const TYPE_LABEL: Record<string, string> = {
  count: "Count",
  recent_activity: "Recent activity",
  assigned_to_me: "Assigned to me",
  due_this_week: "Due this week",
  velocity: "Velocity",
  burndown: "Burndown",
  cards_by_type: "Cards by type",
  markdown_note: "Note",
  on_roadmap: "On roadmap",
};

const SIZES: Array<{ id: GadgetSize; cols: number; rows: number }> = [
  { id: "1x1", cols: 1, rows: 1 },
  { id: "2x1", cols: 2, rows: 1 },
  { id: "2x2", cols: 2, rows: 2 },
  { id: "3x1", cols: 3, rows: 1 },
  { id: "3x2", cols: 3, rows: 2 },
];

const SELECT_CLS =
  "w-full h-10 rounded-md border border-hairline bg-[color:var(--surface)] px-3 text-sm text-fg outline-none hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60";

export function EditGadgetDialog({
  open,
  onOpenChange,
  id,
  type,
  config,
  size,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id: string;
  type: string;
  config: Record<string, unknown>;
  size: string;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [nextSize, setNextSize] = useState<GadgetSize>(
    (size as GadgetSize) ?? "1x1",
  );
  const [what, setWhat] = useState<
    "open_cards" | "overdue" | "my_assignments" | "completed_this_week"
  >((config.what as never) ?? "open_cards");
  const [limit, setLimit] = useState<number>((config.limit as number) ?? 10);
  const [n, setN] = useState<number>((config.n as number) ?? 6);
  const [body, setBody] = useState<string>((config.body as string) ?? "");

  // Reset local state whenever the dialog reopens with a new gadget.
  useEffect(() => {
    if (!open) return;
    setNextSize((size as GadgetSize) ?? "1x1");
    setWhat((config.what as never) ?? "open_cards");
    setLimit((config.limit as number) ?? 10);
    setN((config.n as number) ?? 6);
    setBody((config.body as string) ?? "");
  }, [open, config, size]);

  function buildConfig(): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...config };
    switch (type) {
      case "count":
        merged.what = what;
        break;
      case "recent_activity":
        merged.limit = limit;
        break;
      case "velocity":
        merged.n = n;
        break;
      case "markdown_note":
        merged.body = body;
        break;
    }
    return merged;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startT(async () => {
      try {
        await updateGadget({
          id,
          config: buildConfig(),
          size: nextSize,
        });
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const submitDisabled =
    pending || (type === "markdown_note" && !body.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit gadget</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1">
            <Label>Type</Label>
            <p className="text-sm text-fg">
              {TYPE_LABEL[type] ?? type}{" "}
              <span className="mono-meta-sm text-fg-faint">(locked)</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label>Size</Label>
            <div
              role="radiogroup"
              aria-label="Gadget size"
              className="flex items-end gap-2"
            >
              {SIZES.map((s) => {
                const selected = nextSize === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={s.id}
                    onClick={() => setNextSize(s.id)}
                    className={`inline-flex flex-col items-center gap-1.5 p-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                      selected
                        ? "bg-fg/10"
                        : "hover:bg-[color:var(--surface)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`block rounded-sm border ${
                        selected
                          ? "border-fg/60 bg-fg/30"
                          : "border-hairline-hi bg-[color:var(--surface-strong)]"
                      }`}
                      style={{
                        width: `${s.cols * 14}px`,
                        height: `${s.rows * 14}px`,
                      }}
                    />
                    <span
                      className={`mono-meta-sm tabular-nums ${
                        selected ? "text-fg" : "text-fg-faint"
                      }`}
                    >
                      {s.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {type === "count" && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-what">What to count</Label>
              <select
                id="edit-what"
                value={what}
                onChange={(e) =>
                  setWhat(
                    e.target.value as
                      | "open_cards"
                      | "overdue"
                      | "my_assignments"
                      | "completed_this_week",
                  )
                }
                className={SELECT_CLS}
              >
                <option value="open_cards">Open cards</option>
                <option value="overdue">Overdue</option>
                <option value="my_assignments">My assignments</option>
                <option value="completed_this_week">
                  Completed this week
                </option>
              </select>
            </div>
          )}

          {type === "recent_activity" && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-limit">Limit</Label>
              <Input
                id="edit-limit"
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) =>
                  setLimit(Math.max(1, Math.min(50, Number(e.target.value))))
                }
              />
            </div>
          )}

          {type === "velocity" && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-n">Number of sprints</Label>
              <Input
                id="edit-n"
                type="number"
                min={1}
                max={20}
                value={n}
                onChange={(e) =>
                  setN(Math.max(1, Math.min(20, Number(e.target.value))))
                }
              />
            </div>
          )}

          {type === "markdown_note" && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-body">Body</Label>
              <textarea
                id="edit-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-hairline bg-[color:var(--surface)] px-3 py-2 text-sm font-mono text-fg outline-none hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={submitDisabled}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
