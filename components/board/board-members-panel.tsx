"use client";
import { useEffect, useState, useTransition } from "react";
import { lookupProfileByEmail } from "@/actions/profile-lookup";
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
import { useBoardMembershipSync } from "@/hooks/use-board-membership-sync";

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
  // Live updates so a concurrent admin's role change / removal in
  // another tab is reflected here without a hard reload.
  useBoardMembershipSync(boardId);

  type Preview =
    | { state: "idle" }
    | { state: "checking" }
    | { state: "found"; displayName: string; handle: string | null }
    | { state: "exists" }
    | { state: "missing" };
  const [preview, setPreview] = useState<Preview>({ state: "idle" });

  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed.includes("@") || trimmed.length < 3) {
      setPreview({ state: "idle" });
      return;
    }
    setPreview({ state: "checking" });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await lookupProfileByEmail(trimmed);
        if (cancelled) return;
        if (r.kind === "found") {
          setPreview({
            state: "found",
            displayName: r.displayName,
            handle: r.handle,
          });
        } else if (r.kind === "exists") {
          setPreview({ state: "exists" });
        } else {
          setPreview({ state: "missing" });
        }
      } catch {
        if (!cancelled) setPreview({ state: "idle" });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email]);

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
            aria-describedby="board-invite-preview"
          />
          <div
            id="board-invite-preview"
            className="mono-meta-sm text-fg-faint min-h-4"
            aria-live="polite"
          >
            {preview.state === "checking" && "CHECKING…"}
            {preview.state === "found" && (
              <>
                <span className="text-fg">{preview.displayName}</span>
                {preview.handle && (
                  <span className="text-fg-muted"> · @{preview.handle}</span>
                )}
              </>
            )}
            {preview.state === "exists" && "ACCOUNT EXISTS · ADDING WILL GRANT BOARD ACCESS"}
            {preview.state === "missing" && (
              <span className="text-[color:var(--status-blocked)]">
                NO USER WITH THAT EMAIL
              </span>
            )}
          </div>
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
        <Button
          type="submit"
          disabled={pending || !email || preview.state === "missing"}
        >
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
          </li>
        ))}
      </ul>
    </div>
  );
}
