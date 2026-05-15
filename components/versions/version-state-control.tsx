"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
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
import { updateVersion, deleteVersion } from "@/actions/versions";
import { Trash2 } from "lucide-react";

const STATES = ["unreleased", "released", "archived"] as const;
type State = (typeof STATES)[number];

export function VersionStateControl({
  id,
  state,
}: {
  id: string;
  state: State;
}) {
  const [current, setCurrent] = useState<State>(state);
  const [pending, start] = useTransition();

  function change(next: State) {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    start(async () => {
      try {
        await updateVersion({ id, state: next });
      } catch (err) {
        setCurrent(prev);
        toast.error((err as Error).message);
      }
    });
  }

  function del() {
    start(async () => {
      try {
        await deleteVersion({ id });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="xs" disabled={pending}>
              {current.toUpperCase()}
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(v) => change(v as State)}
          >
            {STATES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {s}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant="destructive"
              size="icon-xs"
              disabled={pending}
              aria-label="Delete version"
              title="Delete version"
              data-testid="delete-version-trigger"
              className="text-red-400 hover:text-red-300 border-red-500/40 hover:border-red-400/70 bg-red-500/10 hover:bg-red-500/20"
            >
              <Trash2 className="size-3" />
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this version?</AlertDialogTitle>
            <AlertDialogDescription>
              The version will be permanently removed. Cards currently linked to
              it will be unlinked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={del}
              disabled={pending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
