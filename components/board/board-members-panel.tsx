"use client";
import { useMemo, useState, useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  addBoardMembersByIds,
  changeBoardMemberRole,
  removeBoardMember,
} from "@/actions/board-members";
import { useBoardMembershipSync } from "@/hooks/use-board-membership-sync";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import {
  PeoplePicker,
  type PickerSelected,
} from "@/components/people/people-picker";

type Role = "admin" | "member" | "observer";
type Member = {
  userId: string;
  role: Role;
  displayName: string;
  avatarUrl: string | null;
};

const ROLE_OPTIONS = [
  { value: "observer", label: "Observer" },
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

export function BoardMembersPanel({
  boardId,
  members,
}: {
  boardId: string;
  members: Member[];
}) {
  const [selected, setSelected] = useState<PickerSelected<Role>[]>([]);
  const [pending, start] = useTransition();
  const isGuest = useIsGuest();
  // Live updates so a concurrent admin's role change / removal in
  // another tab is reflected here without a hard reload.
  useBoardMembershipSync(boardId);

  const existingIds = useMemo(
    () => new Set(members.map((m) => m.userId)),
    [members],
  );

  function add() {
    if (selected.length === 0) return;
    start(async () => {
      try {
        await addBoardMembersByIds({
          boardId,
          members: selected.map((p) => ({ userId: p.id, role: p.role })),
        });
        setSelected([]);
        toast.success(
          selected.length === 1
            ? "Member added to board"
            : `${selected.length} members added to board`,
        );
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      {!isGuest && (
      <div className="space-y-3">
        <PeoplePicker<Role>
          selected={selected}
          onSelectedChange={setSelected}
          roleOptions={ROLE_OPTIONS}
          defaultRole="member"
          excludeIds={existingIds}
          label="Add to board"
          placeholder="Search by name, handle, or email…"
          inputTestId="board-invite-input"
        />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={pending || selected.length === 0}
            onClick={add}
          >
            {pending
              ? "Adding…"
              : selected.length > 1
              ? `Add ${selected.length}`
              : "Add"}
          </Button>
        </div>
      </div>
      )}

      <ul className="divide-y divide-hairline rounded-xl border border-hairline">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center gap-3 p-3"
            data-board-member-id={m.userId}
          >
            <Avatar className="size-8">
              <AvatarImage src={m.avatarUrl ?? undefined} />
              <AvatarFallback>
                {m.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1">{m.displayName}</span>
            <Badge variant="outline">{m.role}</Badge>
            {!isGuest && (
            <>
            <Select
              value={m.role}
              disabled={pending}
              onValueChange={(v) =>
                start(async () => {
                  try {
                    if (
                      !confirm(
                        `Change ${m.displayName}'s board role from ${m.role} to ${v}?`,
                      )
                    ) {
                      return;
                    }
                    await changeBoardMemberRole({
                      boardId,
                      userId: m.userId,
                      role: v as Role,
                    });
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                })
              }
              options={ROLE_OPTIONS}
              size="sm"
              className="w-28"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    if (
                      !confirm(
                        `Remove ${m.displayName} from this board? They may lose access to its cards.`,
                      )
                    ) {
                      return;
                    }
                    await removeBoardMember({ boardId, userId: m.userId });
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                })
              }
            >
              Remove
            </Button>
            </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
