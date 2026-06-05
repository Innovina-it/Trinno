"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, type SelectOption } from "@/components/ui/select";
import { changeMemberRole, removeMember, resendInvitation } from "@/actions/workspace-members";
import { useWorkspaceMembersSync } from "@/hooks/use-workspace-members-sync";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { toast } from "sonner";

type Member = {
  userId: string;
  role: "owner" | "admin" | "member" | "guest";
  displayName: string;
  avatarUrl: string | null;
  pending: boolean;
  email?: string | null;
};

export function MemberList({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: Member[];
}) {
  const [pending, start] = useTransition();
  const isGuest = useIsGuest();
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
          <span className="min-w-0 flex-1 truncate" title={m.displayName}>
            {m.displayName}
          </span>
          <Badge variant="outline" className="shrink-0">
            {m.role}
          </Badge>
          {m.pending && (
            <Badge variant="outline" className="shrink-0 text-fg-faint">
              Pending · invite sent
            </Badge>
          )}
          {!isGuest && m.pending && m.email && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await resendInvitation({ workspaceId, email: m.email! });
                    toast.success("Invite re-sent");
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                })
              }
            >
              Resend
            </Button>
          )}
          {!isGuest && (
          <>
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
              { value: "guest", label: "Guest" },
              ...(m.role === "owner"
                ? ([{ value: "owner", label: "Owner" }] as SelectOption[])
                : []),
            ]}
            size="sm"
            className="w-28 shrink-0"
          />
          <Button
            size="sm"
            variant="destructive"
            className="shrink-0"
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
          </>
          )}
        </li>
      ))}
    </ul>
  );
}
