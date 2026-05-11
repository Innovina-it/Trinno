"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, type SelectOption } from "@/components/ui/select";
import { changeMemberRole, removeMember } from "@/actions/workspace-members";
import { useWorkspaceMembersSync } from "@/hooks/use-workspace-members-sync";
import { toast } from "sonner";

type Member = {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  avatarUrl: string | null;
};

export function MemberList({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: Member[];
}) {
  const [pending, start] = useTransition();
  // Live updates so a concurrent admin's invite / role change / removal
  // in another tab is reflected here without a manual reload.
  useWorkspaceMembersSync(workspaceId);

  return (
    <ul className="divide-y rounded border">
      {members.map((m) => (
        <li key={m.userId} className="flex items-center gap-3 p-3">
          <Avatar className="size-8">
            <AvatarImage src={m.avatarUrl ?? undefined} />
            <AvatarFallback>
              {m.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1">{m.displayName}</span>
          <Badge variant="outline">{m.role}</Badge>
          <Select
            value={m.role}
            disabled={m.role === "owner" || pending}
            onValueChange={(v) =>
              start(async () => {
                try {
                  if (
                    !confirm(
                      `Change ${m.displayName}'s workspace role from ${m.role} to ${v}?`,
                    )
                  ) {
                    return;
                  }
                  await changeMemberRole({
                    workspaceId,
                    userId: m.userId,
                    role: v as Member["role"],
                  });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              })
            }
            options={[
              { value: "member", label: "Member" },
              { value: "admin", label: "Admin" },
              ...(m.role === "owner"
                ? ([{ value: "owner", label: "Owner" }] as SelectOption[])
                : []),
            ]}
            size="sm"
            className="w-28"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={m.role === "owner" || pending}
            onClick={() =>
              start(async () => {
                try {
                  if (
                    !confirm(
                      `Remove ${m.displayName} from this workspace? They may lose access to its boards.`,
                    )
                  ) {
                    return;
                  }
                  await removeMember({ workspaceId, userId: m.userId });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              })
            }
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
