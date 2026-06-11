"use client";
import { useState } from "react";
import {
  Check,
  CircleCheck,
  GitCompare,
  History,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  deleteRoadmapBaseline,
  setApprovedBaseline,
} from "@/actions/roadmap-baselines";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { formatDate } from "@/lib/format-date";
import { toast } from "sonner";
import { BaselineSaveDialog } from "./baseline-save-dialog";
import { BaselineRenameDialog } from "./baseline-rename-dialog";

export function BaselineMenu({
  workspaceId,
  onCompare,
}: {
  workspaceId: string;
  onCompare: (id: string) => void;
}) {
  const baselines = useWorkspaceStore((s) => s.baselines);
  const viewerRole = useWorkspaceStore((s) => s.viewerRole);
  const compareBaselineId = useWorkspaceStore((s) => s.compareBaselineId);
  const setBaselines = useWorkspaceStore((s) => s.setBaselines);
  const setCompareBaselineId = useWorkspaceStore((s) => s.setCompareBaselineId);

  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (
      !window.confirm(
        `Delete baseline "${name}" PERMANENTLY? This cannot be undone.`,
      )
    )
      return;
    const res = await deleteRoadmapBaseline({ id });
    if (res.ok) {
      setBaselines(baselines.filter((x) => x.id !== id));
      if (compareBaselineId === id) setCompareBaselineId(null);
    } else {
      toast.error(res.error.message);
    }
  }

  async function handleApprove(id: string) {
    const res = await setApprovedBaseline({ id });
    if (res.ok) {
      // Exactly one approved per workspace: flip locally to mirror the
      // unset-then-set the server performed.
      setBaselines(
        baselines.map((x) => ({ ...x, isApproved: x.id === id })),
      );
    } else {
      toast.error(res.error.message);
    }
  }

  const renameTarget = baselines.find((b) => b.id === renameId) ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="baseline-menu"
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
        >
          <History className="size-3.5" aria-hidden />
          <span className="text-fg">Baselines</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Baselines</DropdownMenuLabel>
            {canManage && (
              <DropdownMenuItem
                data-testid="baseline-save-open"
                onClick={() => setSaveOpen(true)}
              >
                <Plus className="size-3.5" />
                <span className="text-sm">Save baseline…</span>
              </DropdownMenuItem>
            )}
            {baselines.length === 0 && (
              <DropdownMenuItem disabled data-testid="baseline-empty">
                <span className="text-sm text-fg-faint">No baselines yet</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          {baselines.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {baselines.map((b) => (
                  <DropdownMenuItem
                    key={b.id}
                    data-testid={`baseline-row-${b.id}`}
                    onClick={() =>
                      compareBaselineId === b.id
                        ? setCompareBaselineId(null)
                        : onCompare(b.id)
                    }
                    className={
                      // Selected (actively compared) baseline keeps the
                      // surface highlight persistently — that IS the selected
                      // marker. Non-selected rows neutralise Base UI's
                      // roving-focus highlight (fires on menu open, no mouse)
                      // and only tint on real mouse hover. No border/ring.
                      compareBaselineId === b.id
                        ? "bg-[color:var(--surface-hi)] text-fg"
                        : "focus:bg-transparent focus:translate-x-0 hover:bg-[color:var(--surface-hi)] hover:text-fg"
                    }
                  >
                    <GitCompare className="size-3.5 text-fg-faint" />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{b.name}</span>
                        {b.isApproved && (
                          <span
                            data-testid={`baseline-approved-badge-${b.id}`}
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[color:var(--surface-hi)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--accent-emerald)]"
                          >
                            <CircleCheck className="size-2.5" aria-hidden />
                            Approved
                          </span>
                        )}
                      </span>
                      <span className="block mono-meta-sm text-fg-faint">
                        {formatDate(new Date(b.createdAt))}
                      </span>
                    </span>
                    {canManage && (
                      <span className="flex items-center gap-1">
                        {!b.isApproved && (
                          <button
                            type="button"
                            aria-label="Mark as approved"
                            data-testid={`baseline-approve-${b.id}`}
                            className="rounded p-1 text-fg-faint hover:text-[color:var(--accent-emerald)] hover:bg-[rgb(255_255_255/0.08)]"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleApprove(b.id);
                            }}
                          >
                            <Check className="size-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Rename baseline"
                          data-testid={`baseline-rename-${b.id}`}
                          className="rounded p-1 text-fg-faint hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenameId(b.id);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete baseline"
                          data-testid={`baseline-delete-${b.id}`}
                          className="rounded p-1 text-fg-faint hover:text-[color:var(--accent-rose)] hover:bg-[rgb(255_255_255/0.08)]"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleDelete(b.id, b.name);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          {compareBaselineId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="baseline-stop-compare"
                onClick={() => setCompareBaselineId(null)}
              >
                <X className="size-3.5" />
                <span className="text-sm">Stop comparing</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canManage && (
        <BaselineSaveDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          workspaceId={workspaceId}
          onSaved={(meta) => setBaselines([meta, ...baselines])}
        />
      )}

      {canManage && renameTarget && (
        <BaselineRenameDialog
          open={renameId !== null}
          onOpenChange={(o) => {
            if (!o) setRenameId(null);
          }}
          baseline={renameTarget}
          onRenamed={(next) =>
            setBaselines(
              baselines.map((x) =>
                x.id === next.id
                  ? { ...x, name: next.name, note: next.note }
                  : x,
              ),
            )
          }
        />
      )}
    </>
  );
}
