"use client";
import { ChevronDown, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AssigneeOption = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
};

// Multi-select dropdown for picking card assignees. Trigger shows an
// avatar stack of the selected members + count. Menu is a checkbox list
// of all available members. Toggling a row calls onToggle(userId).

export function AssigneePicker({
  members,
  selected,
  onToggle,
  testId,
}: {
  members: AssigneeOption[];
  selected: Set<string> | string[];
  onToggle: (userId: string) => void;
  testId?: string;
}) {
  const selectedIds =
    selected instanceof Set ? selected : new Set(selected);
  const selectedMembers = members.filter((m) => selectedIds.has(m.id));
  const preview = selectedMembers.slice(0, 4);
  const extra = selectedMembers.length - preview.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={testId}
        className="w-full inline-flex items-center gap-1.5 rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus-visible:border-fg/40 min-h-[34px]"
      >
        <Users className="size-3 text-fg-faint" aria-hidden />
        {selectedMembers.length === 0 ? (
          <span className="mono-meta-sm text-fg-faint">Pick assignees</span>
        ) : (
          <>
            <span className="flex -space-x-1.5">
              {preview.map((m) => (
                <Avatar
                  key={m.id}
                  size="sm"
                  className="rounded-none border border-hairline size-4 ring-1 ring-[color:var(--surface)]"
                >
                  <AvatarFallback className="rounded-none bg-[color:var(--surface)] text-fg-muted text-[9px] tracking-widest">
                    {m.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </span>
            <span className="mono-meta-sm text-fg tabular-nums">
              {selectedMembers.length}
              {extra > 0 ? ` (+${extra})` : ""}
            </span>
          </>
        )}
        <ChevronDown className="ml-auto size-3 text-fg-faint" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[14rem] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[12rem] overflow-y-auto"
      >
        {members.length === 0 ? (
          <div className="px-2 py-1.5 mono-meta-sm text-fg-faint">
            No members
          </div>
        ) : (
          members.map((m) => {
            const on = selectedIds.has(m.id);
            return (
              <DropdownMenuCheckboxItem
                key={m.id}
                checked={on}
                onCheckedChange={() => onToggle(m.id)}
                onSelect={(e) => e.preventDefault()}
                data-user-id={m.id}
                className="gap-2"
              >
                <Avatar
                  size="sm"
                  className="rounded-none border border-hairline size-4"
                >
                  <AvatarFallback className="rounded-none bg-transparent text-fg-muted text-[9px] tracking-widest">
                    {m.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs normal-case tracking-normal">
                  {m.displayName}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Compact selected-chip strip — render alongside or below the trigger
// when you want a visible list of who is currently assigned with an
// X-to-remove affordance.
export function AssigneeChips({
  members,
  selected,
  onRemove,
  emptyLabel,
}: {
  members: AssigneeOption[];
  selected: Set<string> | string[];
  onRemove?: (userId: string) => void;
  emptyLabel?: string;
}) {
  const selectedIds =
    selected instanceof Set ? selected : new Set(selected);
  const selectedMembers = members.filter((m) => selectedIds.has(m.id));
  if (selectedMembers.length === 0) {
    return emptyLabel ? (
      <p className="mono-meta-sm text-fg-faint">{emptyLabel}</p>
    ) : null;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {selectedMembers.map((m) => (
        <li key={m.id}>
          <span
            data-user-id={m.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-transparent px-1.5 py-0.5 text-[10px] text-fg-muted"
          >
            <Avatar
              size="sm"
              className="rounded-none border border-current size-4"
            >
              <AvatarFallback className="rounded-none bg-transparent text-current text-[9px] tracking-widest">
                {m.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="normal-case tracking-normal">
              {m.displayName}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                aria-label={`Remove ${m.displayName}`}
                className="ml-0.5 text-fg-faint hover:text-fg"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
