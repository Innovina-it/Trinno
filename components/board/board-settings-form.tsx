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
import { renameBoard, setBoardArchived, deleteBoard } from "@/actions/boards";
import { toast } from "sonner";
import { FavoriteToggle } from "@/components/workspace/favorite-toggle";

export function BoardSettingsForm({
  board,
  favorited = false,
}: {
  board: {
    id: string;
    title: string;
    archived: boolean;
    workspaceId: string;
  };
  favorited?: boolean;
}) {
  const [title, setTitle] = useState(board.title);
  const [pending, start] = useTransition();
  const router = useRouter();

  function rename(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await renameBoard({ id: board.id, title });
        toast.success("Renamed");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }
  function toggleArchive() {
    start(async () => {
      try {
        await setBoardArchived({ id: board.id, archived: !board.archived });
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }
  function remove() {
    start(async () => {
      try {
        await deleteBoard({ id: board.id });
        router.push(`/w/${board.workspaceId}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="mono-meta-sm text-fg-faint">BOARD ACTIONS</span>
        <FavoriteToggle boardId={board.id} initial={favorited} />
      </div>
      <form onSubmit={rename} className="space-y-2">
        <Label htmlFor="board-rename">Title</Label>
        <div className="flex gap-2">
          <Input
            id="board-rename"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={1}
            maxLength={120}
            className="max-w-xs"
          />
          <Button type="submit" disabled={pending || title === board.title}>
            Save
          </Button>
        </div>
      </form>
      <Button variant="outline" onClick={toggleArchive} disabled={pending}>
        {board.archived ? "Restore from archive" : "Archive board"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="destructive" size="sm">
              Delete board
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this board?</AlertDialogTitle>
            <AlertDialogDescription>
              The board and all its lists/cards will be permanently removed.
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
