"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
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
import { DatePicker } from "@/components/ui/date-picker";

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dateToIso(d: Date | null): string {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}
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
  const [confirming, setConfirming] = useState(false);
  const dirtyRef = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty },
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
      setConfirming(false);
    }
  }, [open, milestone, reset]);

  // Mirror dirty into ref so dismiss interceptor reads fresh value without
  // re-binding the handler.
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  const submit = useCallback(
    (values: FormValues) => {
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
          dirtyRef.current = false;
          setConfirming(false);
          onOpenChange(false);
          toast.success(isEdit ? "Milestone updated" : "Milestone created");
        } catch {
          toast.error("Failed to save milestone");
        }
      });
    },
    [isEdit, milestone, workspaceId, boardId, onSaved, onOpenChange],
  );

  const commitSave = useCallback(() => {
    void handleSubmit(submit)();
  }, [handleSubmit, submit]);

  const discardAndClose = useCallback(() => {
    dirtyRef.current = false;
    setConfirming(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Intercept dismiss attempts (X, Esc, outside-click) when dirty so edits
  // funnel through the confirm phase instead of silently dropping.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && dirtyRef.current) {
        setConfirming(true);
        return;
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <DatePicker
                  value={isoToDate(field.value)}
                  onChange={(d) => field.onChange(dateToIso(d))}
                  triggerLabel="Set date"
                  inputLabel="Milestone date"
                />
              )}
            />
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

          <DialogFooter
            className="items-center justify-between sm:justify-between"
            data-dirty={isDirty ? "true" : "false"}
            data-confirming={confirming ? "true" : "false"}
          >
            {confirming ? (
              <>
                <span
                  className="mono-meta-sm text-fg-muted"
                  data-testid="milestone-dialog-confirm-prompt"
                >
                  Save changes?
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={discardAndClose}
                    disabled={pending}
                    data-testid="milestone-dialog-discard"
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    onClick={commitSave}
                    disabled={pending}
                    data-testid="milestone-dialog-confirm-save"
                  >
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                variant={isDirty ? "default" : "outline"}
                onClick={isDirty ? commitSave : () => onOpenChange(false)}
                disabled={pending}
                data-testid="milestone-dialog-close"
                data-dirty={isDirty ? "true" : "false"}
                className="ml-auto"
              >
                {isDirty
                  ? pending
                    ? "Saving…"
                    : isEdit
                      ? "Save"
                      : "Add milestone"
                  : "Close"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
