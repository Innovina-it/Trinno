"use client";
import Link from "next/link";
import { ChevronDown, Plus, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { useState } from "react";

export type WorkspaceLite = { id: string; name: string };

export function WorkspaceSwitcher({
  workspaces, activeId,
}: { workspaces: WorkspaceLite[]; activeId?: string }) {
  const [openCreate, setOpenCreate] = useState(false);
  const active = workspaces.find(w => w.id === activeId) ?? workspaces[0];

  return (
    <>
      <DropdownMenu>
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
            {workspaces.map(w => {
              const isActive = w.id === active?.id;
              return (
                <DropdownMenuItem
                  key={w.id}
                  render={<Link href={`/w/${w.id}`} />}
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
