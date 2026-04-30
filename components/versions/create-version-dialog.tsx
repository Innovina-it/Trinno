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
import { Plus } from "lucide-react";
import { createVersion } from "@/actions/versions";
import { toast } from "sonner";

export function CreateVersionDialog({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [semver, setSemver] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();

  function reset() {
    setName("");
    setSemver("");
    setDescription("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await createVersion({
          workspaceId,
          name,
          semver: semver || null,
          description: description || null,
        });
        setOpen(false);
        reset();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5 mr-0.5" /> NEW VERSION
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New version</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ver-name">Name</Label>
              <Input
                id="ver-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={1}
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ver-semver">Semver (optional)</Label>
              <Input
                id="ver-semver"
                value={semver}
                onChange={(e) => setSemver(e.target.value)}
                placeholder="1.4.0"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ver-desc">Description (optional)</Label>
              <Input
                id="ver-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
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
