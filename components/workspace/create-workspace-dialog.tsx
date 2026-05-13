"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createWorkspace } from "@/actions/workspaces";
import {
  PeoplePicker,
  type PickerSelected,
} from "@/components/people/people-picker";

type Role = "admin" | "member";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<PickerSelected<Role>[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Reset fields whenever the dialog opens so reopening is clean.
  useEffect(() => {
    if (!open) return;
    setName("");
    setSelected([]);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const ws = await createWorkspace({
          name,
          members: selected.map((p) => ({ id: p.id, role: p.role })),
        });
        onOpenChange(false);
        router.push(`/w/${ws.id}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-2">
            <DialogTitle>New workspace.</DialogTitle>
            <span className="chip">FORM-NW</span>
          </div>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme team"
              required
              minLength={1}
              maxLength={120}
            />
          </div>

          <PeoplePicker<Role>
            selected={selected}
            onSelectedChange={setSelected}
            roleOptions={ROLE_OPTIONS}
            defaultRole="member"
            label="Add members"
            labelHint="optional"
          />

          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
