"use client";
import { useState, useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  inviteBoardMember,
  changeBoardMemberRole,
  removeBoardMember,
} from "@/actions/board-members";

type Member = {
  userId: string;
  role: "admin" | "member" | "observer";
  displayName: string;
  avatarUrl: string | null;
};

type Role = "admin" | "member" | "observer";

export function BoardMembersPanel({
  boardId,
  members,
}: {
  boardId: string;
  members: Member[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [pending, start] = useTransition();

  function invite(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await inviteBoardMember({ boardId, email, role });
        setEmail("");
        toast.success("Member added to board");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="flex items-end gap-2">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="board-invite-email">Email</Label>
          <Input
            id="board-invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="user@company.com"
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => setRole(v as Role)}
          options={[
            { value: "observer", label: "Observer" },
            { value: "member", label: "Member" },
            { value: "admin", label: "Admin" },
          ]}
          className="w-32"
        />
        <Button type="submit" disabled={pending || !email}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>

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
            <Select
              value={m.role}
              disabled={pending}
              onValueChange={(v) =>
                start(async () => {
                  try {
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
              options={[
                { value: "observer", label: "Observer" },
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
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
                    await removeBoardMember({ boardId, userId: m.userId });
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
    </div>
  );
}
