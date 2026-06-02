"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertWorkspaceLink, removeWorkspaceLink } from "@/actions/links";
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
import {
  renameWorkspace,
  deleteWorkspace,
  setWorkspaceAutoAssignCreator,
} from "@/actions/workspaces";
import { toast } from "sonner";

export function WorkspaceSettingsForm({
  workspace,
  workspaceLink,
}: {
  workspace: { id: string; name: string; autoAssignCreator: boolean };
  workspaceLink?: { url: string } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [autoAssign, setAutoAssign] = useState(workspace.autoAssignCreator);
  const [pending, start] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);

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
        toast.success(`Deleted workspace "${workspace.name}"`);
        // Hard navigation. Soft router.push keeps RSC cache and the
        // workspace switcher in the layout still shows the deleted
        // workspace until the next refresh; replace() reloads the
        // shell so listWorkspaces() runs again and `/` redirects to
        // the next remaining workspace (or empty state if none).
        window.location.replace("/");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function toggleAutoAssign(next: boolean) {
    setAutoAssign(next);
    start(async () => {
      try {
        await setWorkspaceAutoAssignCreator({
          id: workspace.id,
          autoAssignCreator: next,
        });
        toast.success(
          next
            ? "Creators will be auto-assigned to new cards"
            : "Auto-assign disabled",
        );
      } catch (err) {
        setAutoAssign(!next);
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

      <label className="flex items-start gap-3 cursor-pointer max-w-md py-1">
        <input
          type="checkbox"
          checked={autoAssign}
          onChange={(e) => toggleAutoAssign(e.target.checked)}
          disabled={pending}
          data-testid="workspace-auto-assign-toggle"
          className="mt-1 size-4 accent-fg cursor-pointer"
        />
        <span className="space-y-0.5">
          <span className="block text-sm text-fg">
            Auto-assign card creator
          </span>
          <span className="block text-xs text-fg-muted">
            New cards in this workspace are automatically assigned to whoever
            creates them. You can still add or remove assignees afterwards.
          </span>
        </span>
      </label>

      <section id="link" className="space-y-2 scroll-mt-20">
        <Label htmlFor="ws-link">Cartella condivisa (link)</Label>
        <p className="text-xs text-fg-faint">
          Mostrato come icona cloud accanto al nome del workspace. Visibile a
          tutti i membri; modificabile solo da owner/admin.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="ws-link"
            readOnly
            value={workspaceLink?.url ?? "Nessun link"}
            className="max-w-xs"
          />
          <Button
            type="button"
            onClick={() => setLinkOpen(true)}
            data-testid="ws-link-manage"
          >
            Modifica
          </Button>
        </div>
        <LinkEditDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          scope="workspace"
          initialUrl={workspaceLink?.url ?? ""}
          onSave={async ({ url }) => {
            const res = await upsertWorkspaceLink({
              workspaceId: workspace.id,
              url,
            });
            if (res.ok) router.refresh();
            else toast.error(res.error.message);
          }}
          onRemove={
            workspaceLink?.url
              ? async () => {
                  const res = await removeWorkspaceLink({
                    workspaceId: workspace.id,
                  });
                  if (res.ok) router.refresh();
                  else toast.error(res.error.message);
                }
              : undefined
          }
        />
      </section>

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
