"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { inviteMember } from "@/actions/workspace-members";
import { toast } from "sonner";

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await inviteMember({ workspaceId, email, role });
        setEmail("");
        toast.success("Invited");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="space-y-1.5 flex-1">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline">
              Role: {role}
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={role}
            onValueChange={(v) => setRole(v as "admin" | "member")}
          >
            <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="submit" disabled={pending || !email}>
        Invite
      </Button>
    </form>
  );
}
