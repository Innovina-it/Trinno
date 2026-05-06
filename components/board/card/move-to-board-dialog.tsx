"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getBoardsWithLists } from "@/actions/boards";
import { moveCardCrossBoard } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";

type BoardWithLists = Awaited<ReturnType<typeof getBoardsWithLists>>[number];

/**
 * Plan #16b-γ-D (#37) — cross-board move dialog.
 *
 * Three cascading dropdowns: workspace → board → list. We seed the
 * workspace + board to the source defaults so the common in-board move
 * is one click. On confirm we call `moveCardCrossBoard` which RLS-gates
 * against the user's membership of the destination board.
 *
 * The card route auto-navigates to the new board path on success so
 * the modal/page doesn't 404.
 */
export function MoveToBoardDialog({
  open,
  onOpenChange,
  cardId,
  currentBoardId,
  currentWorkspaceId,
  cardTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cardId: string;
  currentBoardId: string;
  currentWorkspaceId?: string;
  cardTitle?: string;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardWithLists[]>([]);
  const [loading, setLoading] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(currentWorkspaceId ?? "");
  const [boardId, setBoardId] = useState(currentBoardId);
  const [listId, setListId] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getBoardsWithLists()
      .then((rows) => {
        if (cancelled) return;
        setBoards(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setBoards([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const workspaces = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of boards) {
      if (!seen.has(b.workspaceId)) seen.set(b.workspaceId, b.workspaceName);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [boards]);

  const boardsForWs = useMemo(
    () => boards.filter((b) => b.workspaceId === workspaceId),
    [boards, workspaceId],
  );

  // Keep selections coherent when the user changes a higher dropdown.
  useEffect(() => {
    if (!workspaceId && workspaces.length > 0) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, workspaceId]);

  useEffect(() => {
    if (boardsForWs.length === 0) return;
    if (!boardsForWs.some((b) => b.boardId === boardId)) {
      setBoardId(boardsForWs[0].boardId);
    }
  }, [boardsForWs, boardId]);

  const selectedBoard = useMemo(
    () => boards.find((b) => b.boardId === boardId),
    [boards, boardId],
  );

  useEffect(() => {
    if (!selectedBoard) return;
    if (selectedBoard.lists.length === 0) {
      setListId("");
      return;
    }
    if (!selectedBoard.lists.some((l) => l.id === listId)) {
      setListId(selectedBoard.lists[0].id);
    }
  }, [selectedBoard, listId]);

  function submit() {
    if (!listId) return;
    start(async () => {
      try {
        const r = await moveCardCrossBoard({ cardId, toListId: listId });
        toast.success("Card moved");
        onOpenChange(false);
        // Route to the destination board so the modal/page doesn't
        // 404 against the old boardId in the URL.
        if (r.boardId !== currentBoardId) {
          router.push(`/b/${r.boardId}/c/${cardId}`);
        } else {
          router.refresh();
        }
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Move failed: ${m}` });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move card.</DialogTitle>
        </DialogHeader>
        {cardTitle && (
          <p className="text-sm text-fg-muted truncate" title={cardTitle}>
            {cardTitle}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-fg-muted italic py-3">Loading boards…</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-fg-muted italic py-3">
            No accessible destination boards.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="move-ws">Workspace</Label>
              <Select
                value={workspaceId}
                onValueChange={setWorkspaceId}
                data-testid="move-ws"
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="move-board">Board</Label>
              <Select
                value={boardId}
                onValueChange={setBoardId}
                data-testid="move-board"
                disabled={boardsForWs.length === 0}
                options={boardsForWs.map((b) => ({
                  value: b.boardId,
                  label: b.boardTitle,
                }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="move-list">List</Label>
              <Select
                value={listId}
                onValueChange={setListId}
                data-testid="move-list"
                disabled={!selectedBoard || selectedBoard.lists.length === 0}
                options={
                  !selectedBoard || selectedBoard.lists.length === 0
                    ? [{ value: "", label: "No lists in this board" }]
                    : selectedBoard.lists.map((l) => ({
                        value: l.id,
                        label: l.title,
                      }))
                }
                className="w-full"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={pending || !listId}
                data-testid="move-confirm"
              >
                Move
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
