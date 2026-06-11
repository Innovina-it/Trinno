"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  changeMemberRole,
  removeMember,
  resendInvitation,
  fetchWorkspaceMembers,
} from "@/actions/workspace-members";
import { useWorkspaceMembersSync } from "@/hooks/use-workspace-members-sync";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
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
  const router = useRouter();

  // Live local copy: rendered instead of the server prop so a concurrent
  // admin's invite / role change / removal patches in place without a
  // route refresh. Own actions still revalidate, which re-feeds `members`.
  const [liveMembers, setLiveMembers] = useState(members);
  useEffect(() => {
    setLiveMembers(members);
  }, [members]);

  // Viewer id, seeded once — lets the event handler detect self-removal
  // synchronously, without an async hop that could race the router.
  const uidRef = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    createSupabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) uidRef.current = data.session?.user.id ?? null;
      });
    return () => {
      alive = false;
    };
  }, []);

  // Refresh at most once per mount: duplicate event deliveries must not
  // stack a second refresh onto an in-flight eject transition.
  const ejectedRef = useRef(false);
  // Realtime events can burst (bulk changes); only the latest refetch wins.
  const fetchSeq = useRef(0);
  useWorkspaceMembersSync(workspaceId, (change) => {
    if (ejectedRef.current) return;
    // Self removed → same synchronous refresh the pre-patch code did; the
    // server redirects to the removed-notice page.
    if (
      change.eventType === "DELETE" &&
      uidRef.current &&
      change.old?.user_id === uidRef.current
    ) {
      ejectedRef.current = true;
      router.refresh();
      return;
    }
    const seq = ++fetchSeq.current;
    (async () => {
      try {
        const fresh = await fetchWorkspaceMembers({ workspaceId });
        if (ejectedRef.current || seq !== fetchSeq.current) return;
        // Revocation fallback: an empty list (RLS hides the workspace) or
        // self missing means this viewer lost access — let the server
        // decide where they land.
        if (
          fresh.length === 0 ||
          (uidRef.current && !fresh.some((m) => m.userId === uidRef.current))
        ) {
          ejectedRef.current = true;
          router.refresh();
          return;
        }
        setLiveMembers(fresh);
      } catch {
        if (!ejectedRef.current) {
          ejectedRef.current = true;
          router.refresh();
        }
      }
    })();
  });

  return (
    <ul className="divide-y rounded border">
      {liveMembers.map((m) => (
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
