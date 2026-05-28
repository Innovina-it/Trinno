"use client";
import { useEffect, useState, useTransition } from "react";
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
import { lookupProfileByEmail } from "@/actions/profile-lookup";
import { toast } from "sonner";

type Preview =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; displayName: string; handle: string | null }
  | { state: "exists" } // user exists but caller can't read their profile
  | { state: "missing" };

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<Preview>({ state: "idle" });

  // Debounce the lookup so we don't fire on every keystroke.
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await inviteMember({ workspaceId, email, role });
        setEmail("");
        setPreview({ state: "idle" });
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
          aria-describedby="invite-preview"
        />
        <div
          id="invite-preview"
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
          {preview.state === "exists" && "USER EXISTS"}
          {preview.state === "missing" && (
            <span className="text-[color:var(--status-blocked)]">
              NO USER WITH THAT EMAIL
            </span>
          )}
        </div>
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
            onValueChange={(v) => setRole(v as "admin" | "member" | "guest")}
          >
            <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="guest">Guest (read-only)</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="submit"
        disabled={pending || !email || preview.state === "missing"}
      >
        Invite
      </Button>
    </form>
  );
}
