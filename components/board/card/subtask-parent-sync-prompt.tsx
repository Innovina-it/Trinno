"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBoardStore } from "@/stores/board-store";
import { syncParentFromSubtask } from "@/actions/cards";
import { subtaskSyncBus } from "@/lib/subtask-sync-bus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SyncIntent = "done" | "in_progress";
type PendingPrompt = {
  parentCardId: string;
  parentBoardId: string;
  intent: SyncIntent;
} | null;

/**
 * Board-scoped prompt that reacts to every CompleteToggle on the page
 * (via subtaskSyncBus) and asks the user whether to roll the toggle up
 * to the parent card. Mounted inside BoardStoreProvider so it has
 * access to the live card + list state needed to decide.
 *
 * Replaces the DB-trigger cascade removed in migration 0109. Confirm
 * calls the syncParentFromSubtask server action, which updates the
 * parent and moves it into the board's done / in_progress list.
 */
export function SubtaskParentSyncPrompt() {
  const cards = useBoardStore((s) => s.cards);
  const lists = useBoardStore((s) => s.lists);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, setPending] = useState<PendingPrompt>(null);
  const [submitting, setSubmitting] = useState(false);
  // Suppress repeat prompts for the same (parent, intent) once dismissed
  // in this session. Cleared when the user confirms, when parent state
  // changes externally (realtime / other tab), or when the inverse
  // intent fires for that parent (going Done → In progress resets the
  // dismissal for the next Done transition).
  const dismissed = useRef(new Set<string>());
  const dismissKey = (parentId: string, intent: SyncIntent) =>
    `${parentId}:${intent}`;
  const inverse = (intent: SyncIntent): SyncIntent =>
    intent === "done" ? "in_progress" : "done";

  useEffect(() => {
    return subtaskSyncBus.subscribe((event) => {
      const child = cards.find((c) => c.id === event.cardId);
      if (!child) return;
      const parentId = (child as { parentCardId?: string | null }).parentCardId;
      if (!parentId) return;
      const parent = cards.find((c) => c.id === parentId);
      if (!parent) return;
      const parentList = lists.find((l) => l.id === parent.listId) ?? null;
      const parentCompleted =
        (parent as { completedAt?: Date | string | null }).completedAt != null;
      const parentInDone = parentList?.statusKind === "done";

      const siblings = cards.filter(
        (c) =>
          (c as { parentCardId?: string | null }).parentCardId === parentId &&
          !c.archived,
      );
      if (siblings.length === 0) return;

      const intent: SyncIntent | null = event.completed
        ? siblings.every(
            (c) =>
              (c as { completedAt?: Date | string | null }).completedAt != null,
          ) && !parentCompleted && !parentInDone
          ? "done"
          : null
        : parentCompleted || parentInDone
          ? "in_progress"
          : null;
      if (!intent) return;
      if (dismissed.current.has(dismissKey(parentId, intent))) return;

      setPending({
        parentCardId: parentId,
        parentBoardId: parent.boardId,
        intent,
      });
    });
  }, [cards, lists]);

  async function confirm() {
    if (!pending) return;
    setSubmitting(true);
    try {
      const r = await syncParentFromSubtask({
        parentCardId: pending.parentCardId,
        boardId: pending.parentBoardId,
        intent: pending.intent,
      });
      updateCardLocal(pending.parentCardId, {
        completedAt: r.completedAt ?? null,
        dueComplete: r.completedAt != null,
        listId: r.listId,
      } as Partial<(typeof cards)[number]>);
      // Reset the inverse-intent dismissal: a successful Done sync means
      // the next In progress prompt should fire freely (and vice versa).
      dismissed.current.delete(
        dismissKey(pending.parentCardId, inverse(pending.intent)),
      );
      toast.success(
        pending.intent === "done"
          ? "Card moved to Done"
          : "Card moved to In progress",
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
      setPending(null);
    }
  }

  function dismiss() {
    if (!pending) return;
    dismissed.current.add(dismissKey(pending.parentCardId, pending.intent));
    setPending(null);
  }

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) dismiss();
      }}
    >
      <AlertDialogContent data-testid="subtask-parent-sync-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending?.intent === "done"
              ? "Move card to Done?"
              : "Reopen card?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.intent === "done"
              ? "Last sub-task closed. Mark this card Done and move it to the Done column?"
              : "Sub-task reopened. Move this card back to In progress?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} onClick={dismiss}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={submitting}>
            {pending?.intent === "done" ? "Move to Done" : "Move to In progress"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
