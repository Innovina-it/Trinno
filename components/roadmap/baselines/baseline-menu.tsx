"use client";
import { useState } from "react";
import { GitCompare, History, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { formatDate } from "@/lib/format-date";
import { BaselineSaveDialog } from "./baseline-save-dialog";

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
                    onClick={() => onCompare(b.id)}
                    className={
                      compareBaselineId === b.id
                        ? "bg-[color:var(--surface-hi)] text-fg"
                        : undefined
                    }
                  >
                    <GitCompare className="size-3.5 text-fg-faint" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm">{b.name}</span>
                      <span className="block mono-meta-sm text-fg-faint">
                        {formatDate(new Date(b.createdAt))}
                      </span>
                    </span>
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
    </>
  );
}
