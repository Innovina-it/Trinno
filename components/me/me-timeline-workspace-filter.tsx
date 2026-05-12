"use client";
/**
 * Multi-select workspace filter for /me/timeline.
 * Updates URL param ?ws=id1,id2,...
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { X } from "lucide-react";

type Workspace = { id: string; name: string };

export function MeTimelineWorkspaceFilter({
  workspaces,
  selected,
}: {
  workspaces: Workspace[];
  selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    push(next);
  }

  function push(ids: string[]) {
    const params = new URLSearchParams(sp.toString());
    if (ids.length > 0) params.set("ws", ids.join(","));
    else params.delete("ws");
    start(() =>
      router.replace(`${pathname}?${params.toString()}`, { scroll: false }),
    );
  }

  const label =
    selected.length === 0
      ? "All workspaces"
      : selected.length === 1
        ? (workspaces.find((w) => w.id === selected[0])?.name ?? "1 workspace")
        : `${selected.length} workspaces`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="timeline-ws-filter"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
            selected.length > 0
              ? "border-fg/40 bg-fg/10 text-fg"
              : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
          }`}
        >
          <span className="text-fg">{label}</span>
          <ChevronDown className="size-3 text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Filter by workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((w) => (
            <DropdownMenuCheckboxItem
              key={w.id}
              checked={selected.includes(w.id)}
              onCheckedChange={() => toggle(w.id)}
            >
              {w.name}
            </DropdownMenuCheckboxItem>
          ))}
          {selected.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => push([])} className="text-fg-muted">
                <X className="size-3.5" aria-hidden />
                Show all workspaces
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Active workspace chips */}
      {selected.length > 0 &&
        selected.map((id) => {
          const ws = workspaces.find((w) => w.id === id);
          if (!ws) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="inline-flex items-center gap-1 rounded-full border border-fg/30 bg-fg/10 px-2.5 py-1.5 text-xs text-fg hover:bg-fg/20"
            >
              {ws.name}
              <X className="size-3" aria-hidden />
            </button>
          );
        })}
    </div>
  );
}
