"use client";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Check, Search } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { useMemo, useState } from "react";

export type WorkspaceLite = { id: string; name: string };

// Plan #16b-γ-D (#39) — when the user belongs to more than 5 workspaces
// the flat list becomes hard to scan. A search input pinned to the top
// of the dropdown filters by `name.toLowerCase().includes(q)` so the
// active workspace is always one or two keystrokes away. We avoid
// rendering the input below the threshold so users with 1–5 workspaces
// see no extra noise.
const SEARCH_THRESHOLD = 5;

export function WorkspaceSwitcher({
  workspaces, activeId,
}: { workspaces: WorkspaceLite[]; activeId?: string }) {
  const router = useRouter();
  const [openCreate, setOpenCreate] = useState(false);
  const [q, setQ] = useState("");
  const active = workspaces.find(w => w.id === activeId) ?? workspaces[0];

  const showSearch = workspaces.length > SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    if (!showSearch || !q.trim()) return workspaces;
    const needle = q.toLowerCase();
    return workspaces.filter(w => w.name.toLowerCase().includes(needle));
  }, [workspaces, q, showSearch]);

  return (
    <>
      <DropdownMenu
        onOpenChange={(o) => {
          if (!o) setQ("");
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 max-w-[220px] px-2.5 normal-case tracking-normal text-base"
            />
          }
        >
          <span className="serif-display text-lg italic gradient-text-static truncate normal-case tracking-normal">
            {active?.name ?? "Workspaces"}
          </span>
          <ChevronDown className="size-3.5 text-fg-muted transition-transform duration-200 group-aria-expanded/button:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="mono-meta text-fg-muted">Workspaces</span>
            </DropdownMenuLabel>
            {showSearch && (
              <div className="px-2 pb-2">
                <div className="relative">
                  <Search className="size-3.5 text-fg-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    autoFocus
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      // Don't let parent dropdown intercept space/letters.
                      e.stopPropagation();
                    }}
                    placeholder="Search workspaces…"
                    data-testid="workspace-switcher-search"
                    className="h-8 w-full rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] pl-7 pr-2 text-sm outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
                  />
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-fg-faint italic">
                No matches.
              </div>
            )}
            {filtered.map(w => {
              const isActive = w.id === active?.id;
              return (
                <DropdownMenuItem
                  key={w.id}
                  onClick={() => {
                    if (!isActive) {
                      router.push(`/w/${w.id}`);
                      router.refresh();
                    }
                  }}
                  className={isActive ? "bg-[color:var(--surface-hi)] text-fg" : undefined}
                >
                  <span className="flex-1 truncate text-sm">{w.name}</span>
                  {isActive && <Check className="size-3.5 text-[color:var(--accent-cyan)]" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenCreate(true)}>
            <Plus className="size-3.5 mr-2 text-[color:var(--accent-magenta)]" />
            <span className="mono-meta">New workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={openCreate} onOpenChange={setOpenCreate} />
    </>
  );
}
