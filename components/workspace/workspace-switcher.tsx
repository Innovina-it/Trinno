"use client";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1" />}>
          {active?.name ?? "Workspaces"} <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map(w => (
              <DropdownMenuItem key={w.id} render={<Link href={`/w/${w.id}`} />}>
                {w.name}
              </DropdownMenuItem>
            ))}
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
