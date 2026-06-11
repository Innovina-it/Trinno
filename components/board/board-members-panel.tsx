"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  addBoardMembersByIds,
  changeBoardMemberRole,
  fetchBoardMembers,
  removeBoardMember,
} from "@/actions/board-members";
import { useBoardMembershipSync } from "@/hooks/use-board-membership-sync";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
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
  const router = useRouter();

  // Live local copy: rendered instead of the server prop so a concurrent
  // admin's add / role change / removal patches in place without a route
  // refresh. Own actions still revalidate, which re-feeds `members`.
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

  // Refresh at most once: StrictMode double-subscription can deliver the
  // same event twice, and a second refresh landing mid-transition crashes
  // the Next dev router ("Rendered more hooks…").
  const ejectedRef = useRef(false);
  // Realtime events can burst (bulk add); only the latest refetch wins.
  const fetchSeq = useRef(0);
  useBoardMembershipSync(boardId, (change) => {
    if (ejectedRef.current) return;
    // Self removed from the board: keep today's full-refresh behavior,
    // which ejects the viewer from a private board's settings page. An
    // empty member list is legitimate here, so it can't signal that.
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
        const fresh = await fetchBoardMembers({ boardId });
        if (ejectedRef.current || seq !== fetchSeq.current) return;
        setLiveMembers(fresh);
      } catch {
        if (!ejectedRef.current) {
          ejectedRef.current = true;
          router.refresh();
        }
      }
    })();
  });

  const existingIds = useMemo(
    () => new Set(liveMembers.map((m) => m.userId)),
    [liveMembers],
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
        {liveMembers.map((m) => (
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
