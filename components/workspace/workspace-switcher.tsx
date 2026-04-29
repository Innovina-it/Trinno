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
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1 font-medium max-w-[180px]" />}>
          {active?.name ?? "Workspaces"} <ChevronDown className="size-4 transition-transform duration-150 group-aria-expanded/button:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map(w => {
              const isActive = w.id === active?.id;
              return (
                <DropdownMenuItem
                  key={w.id}
                  render={<Link href={`/w/${w.id}`} />}
                  className={isActive ? "bg-accent/60 font-semibold text-accent-foreground" : undefined}
                >
                  <span className="flex-1 truncate">{w.name}</span>
                  {isActive && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenCreate(true)}>
            <Plus className="size-4 mr-2" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={openCreate} onOpenChange={setOpenCreate} />
    </>
  );
}
