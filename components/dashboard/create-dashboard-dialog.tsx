"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Select } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { createDashboard } from "@/actions/dashboards";
import { toast } from "sonner";

export function CreateDashboardButton({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const [workspaceId, setWorkspaceId] = useState<string>(
    workspaces[0]?.id ?? "",
  );
  const [pending, startT] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startT(async () => {
      try {
        const d = await createDashboard({
          name,
          scope,
          workspaceId: scope === "workspace" ? workspaceId : null,
        });
        setOpen(false);
        setName("");
        router.push(`/dashboards/${d.id}`);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="new-dashboard-btn"
      >
        <Plus className="size-3.5 mr-0.5" /> New dashboard
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New dashboard</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dash-name">Name</Label>
              <Input
                id="dash-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={1}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === "personal" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScope("personal")}
                >
                  Personal
                </Button>
                <Button
                  type="button"
                  variant={scope === "workspace" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScope("workspace")}
                  disabled={workspaces.length === 0}
                >
                  Workspace
                </Button>
              </div>
            </div>
            {scope === "workspace" && (
              <div className="space-y-1.5">
                <Label htmlFor="dash-ws">Workspace</Label>
                <Select
                  value={workspaceId}
                  onValueChange={setWorkspaceId}
                  options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                  className="w-full"
                />
              </div>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  pending ||
                  !name.trim() ||
                  (scope === "workspace" && !workspaceId)
                }
              >
                {pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
