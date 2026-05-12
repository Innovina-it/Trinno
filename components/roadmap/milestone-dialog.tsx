"use client";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMilestone,
  updateMilestone,
} from "@/actions/milestones";

// Re-exported so milestone-markers.tsx can import without a circular dep.
export type MilestoneRow = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  date: string | Date;
  description: string | null;
  color: string;
  icon: string | null;
};

const FormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  date: z.string().min(1, "Date is required"),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().optional(),
  icon: z.string().trim().max(50).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

export interface MilestoneDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  boardId?: string | null;
  /** Pass to edit an existing milestone; omit to create. */
  milestone?: MilestoneRow | null;
  onSaved: (row: MilestoneRow) => void;
}

export function MilestoneDialog({
  open,
  onOpenChange,
  workspaceId,
  boardId,
  milestone,
  onSaved,
}: MilestoneDialogProps) {
  const isEdit = Boolean(milestone);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      date: "",
      description: "",
      color: "#6366f1",
      icon: "",
    },
  });

  // Sync form when dialog opens or milestone changes.
  useEffect(() => {
    if (open) {
      reset({
        name: milestone?.name ?? "",
        date: milestone?.date
          ? new Date(milestone.date).toISOString().slice(0, 10)
          : "",
        description: milestone?.description ?? "",
        color: milestone?.color ?? "#6366f1",
        icon: milestone?.icon ?? "",
      });
    }
  }, [open, milestone, reset]);

  function submit(values: FormValues) {
    startTransition(async () => {
      try {
        let saved: MilestoneRow;
        if (isEdit && milestone) {
          saved = (await updateMilestone({
            id: milestone.id,
            name: values.name,
            date: values.date,
            description: values.description || null,
            color: values.color || "#6366f1",
            icon: values.icon || null,
          })) as MilestoneRow;
        } else {
          saved = (await createMilestone({
            workspaceId,
            boardId: boardId ?? null,
            name: values.name,
            date: values.date,
            description: values.description || null,
            color: values.color || "#6366f1",
            icon: values.icon || null,
          })) as MilestoneRow;
        }
        onSaved(saved);
        onOpenChange(false);
        toast.success(isEdit ? "Milestone updated" : "Milestone created");
      } catch {
        toast.error("Failed to save milestone");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="milestone-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit milestone" : "Add milestone"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="m-name">Name</Label>
            <Input
              id="m-name"
              placeholder="Milestone name"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-date">Date</Label>
            <Input id="m-date" type="date" {...register("date")} />
            {errors.date && (
              <p className="text-xs text-red-500">{errors.date.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-description">Description (optional)</Label>
            <textarea
              id="m-description"
              rows={3}
              placeholder="Optional description…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              {...register("description")}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="space-y-1 flex-1">
              <Label htmlFor="m-color">Color</Label>
              <Input
                id="m-color"
                type="color"
                className="h-9 w-full cursor-pointer p-1"
                {...register("color")}
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label htmlFor="m-icon">Icon (emoji, optional)</Label>
              <Input
                id="m-icon"
                placeholder="🏁"
                maxLength={10}
                {...register("icon")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add milestone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
