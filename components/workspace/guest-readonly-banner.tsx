"use client";
// Plan #0111 — read-only banner for workspace guests.
//
// Rendered inside WorkspaceStoreProvider on workspace + board pages so
// guests get an unambiguous signal that the surface is read-only.
// `useIsGuest` returns false outside a guest context, so the banner
// only paints when it should.

import { Lock } from "lucide-react";
import { useIsGuest } from "@/lib/permissions/use-is-guest";

export function GuestReadonlyBanner() {
  const isGuest = useIsGuest();
  if (!isGuest) return null;
  return (
    <div
      data-testid="guest-readonly-banner"
      className="flex items-center gap-2 border-b border-hairline bg-[color:var(--surface)] px-4 py-2 text-xs text-fg-muted"
    >
      <Lock className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
      <span>
        <span className="font-medium text-fg">Read-only access.</span>{" "}
        You can change the status of cards assigned to you. Other edits
        are disabled.
      </span>
    </div>
  );
}
