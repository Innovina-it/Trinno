"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { completeSprint } from "@/actions/sprints";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export function CompleteSprintDialog({
  sprintId,
  otherSprints,
}: {
  sprintId: string;
  otherSprints: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [carryoverTo, setCarryoverTo] = useState<string>("backlog");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await completeSprint({ id: sprintId, carryoverTo });
        setOpen(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-3 mr-1" /> COMPLETE
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete sprint</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-fg-muted">
              Move cards not yet marked complete to:
            </p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="carry"
                  value="backlog"
                  checked={carryoverTo === "backlog"}
                  onChange={() => setCarryoverTo("backlog")}
                />
                Backlog
              </label>
              {otherSprints.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="carry"
                    value={s.id}
                    checked={carryoverTo === s.id}
                    onChange={() => setCarryoverTo(s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Completing…" : "Complete sprint"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
