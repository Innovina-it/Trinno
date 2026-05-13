"use client";
import { Check, ChevronDown, Users, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AssigneeOption = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
};

// Multi-select dropdown for picking card assignees. Trigger shows a
// summary of who is selected; menu shows every option with a check on
// the selected ones. Toggling a row calls onToggle(userId).

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

// Stable colour per id so two avatars never blur into one another. Uses
// hue rotation across a tinted palette consistent with the brand neutrals.
const SWATCHES = [
  "bg-emerald-500/20 text-emerald-200",
  "bg-violet-500/20 text-violet-200",
  "bg-amber-500/20 text-amber-200",
  "bg-rose-500/20 text-rose-200",
  "bg-sky-500/20 text-sky-200",
  "bg-fuchsia-500/20 text-fuchsia-200",
];

function swatchFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

function AvatarDot({
  member,
  size = 22,
  ring = false,
}: {
  member: AssigneeOption;
  size?: number;
  ring?: boolean;
}) {
  const px = `${size}px`;
  return (
    <span
      aria-hidden
      className={[
        "inline-flex items-center justify-center rounded-full font-medium tabular-nums leading-none",
        swatchFor(member.id),
        ring ? "ring-2 ring-[color:var(--surface)]" : "",
      ].join(" ")}
      style={{ width: px, height: px, fontSize: Math.round(size * 0.42) }}
      title={member.displayName}
    >
      {initials(member.displayName)}
    </span>
  );
}

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
  const preview = selectedMembers.slice(0, 3);
  const extra = selectedMembers.length - preview.length;

  const sortedMembers = [...members].sort((a, b) => {
    const aOn = selectedIds.has(a.id) ? 0 : 1;
    const bOn = selectedIds.has(b.id) ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={testId}
        className="w-full inline-flex items-center gap-2 rounded-md border border-hairline bg-transparent px-2.5 py-1.5 text-fg outline-none hover:border-fg/30 focus-visible:border-fg/50 min-h-[36px]"
      >
        <Users className="size-3.5 text-fg-faint shrink-0" aria-hidden />
        {selectedMembers.length === 0 ? (
          <span className="text-xs text-fg-faint">Pick assignees</span>
        ) : (
          <>
            <span className="flex -space-x-2 shrink-0">
              {preview.map((m) => (
                <AvatarDot key={m.id} member={m} size={22} ring />
              ))}
            </span>
            <span className="text-xs text-fg truncate">
              {selectedMembers.length === 1
                ? selectedMembers[0].displayName
                : `${selectedMembers.length} assigned${extra > 0 ? "" : ""}`}
            </span>
          </>
        )}
        <ChevronDown className="ml-auto size-3.5 text-fg-faint shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="max-h-[18rem] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[16rem] overflow-y-auto p-1"
      >
        {members.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-fg-faint">
            No members available
          </div>
        ) : (
          sortedMembers.map((m) => {
            const on = selectedIds.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(m.id)}
                data-user-id={m.id}
                data-checked={on || undefined}
                className={[
                  "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  on
                    ? "bg-fg/8 text-fg"
                    : "text-fg-muted hover:bg-[rgb(255_255_255/0.06)] hover:text-fg",
                ].join(" ")}
              >
                <AvatarDot member={m} size={24} />
                <span className="text-sm flex-1 truncate normal-case tracking-normal">
                  {m.displayName}
                </span>
                {on && (
                  <Check
                    className="size-3.5 text-fg shrink-0"
                    aria-label="Selected"
                  />
                )}
              </button>
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
      <p className="text-xs text-fg-faint">{emptyLabel}</p>
    ) : null;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {selectedMembers.map((m) => (
        <li key={m.id}>
          <span
            data-user-id={m.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] py-0.5 pl-0.5 pr-1.5 text-xs text-fg"
          >
            <AvatarDot member={m} size={18} />
            <span className="normal-case tracking-normal">
              {m.displayName}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                aria-label={`Remove ${m.displayName}`}
                className="ml-0.5 -mr-0.5 rounded-full p-0.5 text-fg-faint hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
