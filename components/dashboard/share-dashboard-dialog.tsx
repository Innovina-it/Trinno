"use client";
import { useEffect, useState, useTransition } from "react";
import { Share2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  shareDashboard,
  changeDashboardRole,
  removeDashboardMember,
} from "@/actions/dashboard-members";
import { lookupProfileByEmail } from "@/actions/profile-lookup";
import type { DashboardMemberRow } from "@/lib/queries/dashboards";

type Preview =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; displayName: string; handle: string | null }
  | { state: "exists" }
  | { state: "missing" };

export function ShareDashboardDialog({
  dashboardId,
  members,
}: {
  dashboardId: string;
  members: DashboardMemberRow[];
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [pending, start] = useTransition();
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await shareDashboard({ dashboardId, email, role });
        setEmail("");
        setPreview({ state: "idle" });
        toast.success("Shared");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function changeRole(userId: string, next: "viewer" | "editor") {
    start(async () => {
      try {
        await changeDashboardRole({ dashboardId, userId, role: next });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function removeMember(userId: string) {
    if (!window.confirm("Remove access?")) return;
    start(async () => {
      try {
        await removeDashboardMember({ dashboardId, userId });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Share2 className="size-3.5" />
            <span>Share</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share dashboard</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="share-email">Invite by email</Label>
            <Input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              required
              aria-describedby="share-preview"
            />
            <div
              id="share-preview"
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
          <div className="flex items-end gap-2">
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "viewer" | "editor")}
              options={[
                { value: "viewer", label: "Viewer" },
                { value: "editor", label: "Editor" },
              ]}
              className="w-32"
            />
            <Button
              type="submit"
              disabled={pending || !email || preview.state === "missing"}
            >
              Invite
            </Button>
          </div>
        </form>

        <div className="space-y-2 pt-2 border-t border-hairline">
          <span className="mono-meta-sm text-fg-faint">SHARED WITH</span>
          {members.length === 0 && (
            <p className="text-sm text-fg-faint italic">Just you.</p>
          )}
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-2"
                data-dashboard-member-id={m.userId}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg truncate">{m.displayName}</div>
                  {m.handle && (
                    <div className="mono-meta-sm text-fg-faint truncate">
                      @{m.handle}
                    </div>
                  )}
                </div>
                <Select
                  value={m.role}
                  disabled={pending}
                  onValueChange={(v) =>
                    changeRole(m.userId, v as "viewer" | "editor")
                  }
                  options={[
                    { value: "viewer", label: "Viewer" },
                    { value: "editor", label: "Editor" },
                  ]}
                  size="sm"
                  className="w-28"
                />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeMember(m.userId)}
                  disabled={pending}
                  className="size-7 rounded-md text-fg-muted hover:text-[color:var(--status-blocked)] hover:bg-[color:var(--surface-strong)] inline-flex items-center justify-center disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
