"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { undoBus } from "@/lib/undo-bus";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Single-owner picker. Distinct from MembersSection (multi-collaborator).
// The owner is the person ultimately accountable; collaborators help.
// `null` = unowned. UI is a flat list of board profiles; click to set,
// click the active row to clear.
export function OwnerSection({ cardId }: { cardId: string }) {
  const profiles = useBoardStore((s) => s.boardProfiles);
  const boardMembers = useBoardStore((s) => s.boardMembers);
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const supa = createSupabaseBrowser();
    supa.auth.getUser().then(({ data }) => {
      if (!cancelled) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!card || profiles.length === 0) return null;

  const ownerId = card.ownerId ?? null;
  const currentRole = boardMembers.find((m) => m.userId === currentUserId)?.role;
  const isAdmin = currentRole === "admin";
  const isWritableMember = currentRole === "admin" || currentRole === "member";
  const isCurrentOwner = currentUserId !== null && ownerId === currentUserId;
  const canChangeOwner =
    currentUserId !== null &&
    (isAdmin || isCurrentOwner || (ownerId === null && isWritableMember));
  const canClearOwner = isAdmin || isCurrentOwner;
  const visibleProfiles =
    isAdmin || isCurrentOwner
      ? profiles
      : profiles.filter((p) => p.id === currentUserId);
  const ownerProfile =
    ownerId === null ? null : profiles.find((p) => p.id === ownerId) ?? null;

  function setOwner(next: string | null) {
    const prev = ownerId;
    if (prev === next) next = null;
    const ownerName =
      next === null
        ? "Owner cleared"
        : `Owner set to ${
            profiles.find((p) => p.id === next)?.displayName ?? "member"
          }`;
    updateCardLocal(cardId, { ownerId: next });
    start(async () => {
      try {
        await updateCard({ id: cardId, ownerId: next });
        undoBus.push({
          message: ownerName,
          undo: async () => {
            updateCardLocal(cardId, { ownerId: prev });
            try {
              await updateCard({ id: cardId, ownerId: prev });
            } catch (err) {
              updateCardLocal(cardId, { ownerId: next });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        updateCardLocal(cardId, { ownerId: prev });
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="owner-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Owner</h3>
        {pending && <span className="mono-meta-sm text-fg-faint">SAVING…</span>}
      </div>
      <p className="text-xs leading-snug text-fg-muted">
        One accountable person. Owners are auto-watched and get ownership
        notifications.
      </p>
      {!canChangeOwner && (
        <div className="inline-flex items-center gap-1.5 rounded border border-hairline px-2 py-1 text-xs text-fg-muted">
          {ownerProfile ? (
            <>
              <Avatar size="sm" className="rounded-none border border-current">
                <AvatarFallback className="rounded-none bg-transparent text-current text-[10px] tracking-widest">
                  {ownerProfile.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span>{ownerProfile.displayName}</span>
            </>
          ) : (
            <span>Unowned</span>
          )}
        </div>
      )}
      {canChangeOwner && (
      <ul className="flex flex-wrap gap-1.5">
        {visibleProfiles.map((p) => {
          const on = ownerId === p.id;
          return (
            <li key={p.id}>
              <Button
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                disabled={pending}
                onClick={() => setOwner(p.id)}
                data-user-id={p.id}
                data-owner={on}
                className="gap-1.5 normal-case tracking-normal"
              >
                <Avatar size="sm" className="rounded-none border border-current">
                  <AvatarFallback className="rounded-none bg-transparent text-current text-[10px] tracking-widest">
                    {p.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">{p.displayName}</span>
              </Button>
            </li>
          );
        })}
        {ownerId !== null && canClearOwner && (
          <li>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setOwner(null)}
              className="text-xs text-fg-muted"
            >
              Clear owner
            </Button>
          </li>
        )}
      </ul>
      )}
    </section>
  );
}
