"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { changeMemberRole, removeMember } from "@/actions/workspace-members";
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
          <select
            value={m.role}
            disabled={m.role === "owner" || pending}
            onChange={(e) => {
              const v = e.target.value as Member["role"];
              start(async () => {
                try {
                  await changeMemberRole({
                    workspaceId,
                    userId: m.userId,
                    role: v,
                  });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              });
            }}
            className="h-8 px-2 rounded border bg-background text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            {m.role === "owner" && <option value="owner">Owner</option>}
          </select>
          <Button
            size="sm"
            variant="destructive"
            disabled={m.role === "owner" || pending}
            onClick={() =>
              start(async () => {
                try {
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
