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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dateToIso(d: Date | null): string {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}
import { Plus } from "lucide-react";
import { createSprint } from "@/actions/sprints";
import { toast } from "sonner";

export function CreateSprintDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pending, startT] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startT(async () => {
      try {
        await createSprint({
          workspaceId,
          name,
          goal: goal || null,
          startDate: start || null,
          endDate: end || null,
        });
        setOpen(false);
        setName("");
        setGoal("");
        setStart("");
        setEnd("");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5 mr-0.5" /> New sprint
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New sprint</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={1}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-goal">Goal (optional)</Label>
              <Input
                id="sp-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sp-start">Start</Label>
                <DatePicker
                  value={isoToDate(start)}
                  onChange={(d) => setStart(dateToIso(d))}
                  triggerLabel="Set start"
                  inputLabel="Sprint start date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-end">End</Label>
                <DatePicker
                  value={isoToDate(end)}
                  onChange={(d) => setEnd(dateToIso(d))}
                  triggerLabel="Set end"
                  inputLabel="Sprint end date"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
