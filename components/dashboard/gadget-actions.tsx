"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveGadget, removeGadget } from "@/actions/gadgets";
import { toast } from "sonner";

export function GadgetActions({
  id,
  type: _type,
  dashboardId: _dashboardId,
  config: _config,
  size: _size,
}: {
  id: string;
  type: string;
  dashboardId: string;
  config: Record<string, unknown>;
  size: string;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [open, setOpen] = useState(false);

  function call(fn: () => Promise<unknown>) {
    startT(async () => {
      try {
        await fn();
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Gadget actions"
            data-testid="gadget-actions-trigger"
            className="rounded-md p-1 text-fg-muted hover:text-fg hover:bg-[color:var(--surface-hi)] transition-colors disabled:opacity-50"
            disabled={pending}
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuItem
          onClick={() => call(() => moveGadget({ id, direction: "up" }))}
        >
          <ChevronUp className="size-3.5 mr-1" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => call(() => moveGadget({ id, direction: "down" }))}
        >
          <ChevronDown className="size-3.5 mr-1" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => call(() => removeGadget({ id }))}
        >
          <Trash2 className="size-3.5 mr-1" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
