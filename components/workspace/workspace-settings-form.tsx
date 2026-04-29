"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { renameWorkspace, deleteWorkspace } from "@/actions/workspaces";
import { toast } from "sonner";

export function WorkspaceSettingsForm({
  workspace,
}: {
  workspace: { id: string; name: string };
}) {
  const [name, setName] = useState(workspace.name);
  const [pending, start] = useTransition();
  const router = useRouter();

  function rename(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await renameWorkspace({ id: workspace.id, name });
        toast.success("Renamed");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }
  function remove() {
    start(async () => {
      try {
        await deleteWorkspace({ id: workspace.id });
        router.push("/");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={rename} className="space-y-2">
        <Label htmlFor="ws-rename">Name</Label>
        <div className="flex gap-2">
          <Input
            id="ws-rename"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={1}
            maxLength={120}
            className="max-w-xs"
          />
          <Button type="submit" disabled={pending || name === workspace.name}>
            Save
          </Button>
        </div>
      </form>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="destructive" size="sm">
              Delete workspace
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              All boards, lists, and cards in this workspace will be permanently
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
