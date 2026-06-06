"use client";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/actions/auth";
import { publishAuthEvent } from "@/lib/auth/broadcast";
import { useUserPreferences } from "@/lib/preferences/provider";

function deriveInitials(email: string): string {
  // Pull initials from the email's local-part. Prefer characters around `.`,
  // `-`, or `_`; fall back to the first two letters. No-op on empty string.
  const local = (email.split("@")[0] ?? "").trim();
  if (!local) return "??";
  const parts = local
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

/**
 * Identity-only menu. Navigation lives in the command palette (⌘K) and
 * the primary nav, not here. Avatar exposes signed-in email + log out;
 * any future profile / settings entries belong on the user-settings page.
 */
export function AccountMenu({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const initials = deriveInitials(email);
  const { flushPreferences } = useUserPreferences();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-9 shrink-0 rounded-full bg-[color:var(--surface-strong)] border border-[color:var(--hairline-hi)] text-[10px] font-semibold text-fg hover:bg-[color:var(--surface-hi)] transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [@media(hover:none)_and_(pointer:coarse)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:min-w-11"
        aria-label={`Account (${email})`}
        title={email}
        data-testid="account-menu-trigger"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
              SIGNED IN
            </span>
            <span className="text-sm truncate" title={email}>
              {email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          nativeButton={false}
          render={
            <Link href="/settings" data-testid="account-menu-settings" />
          }
          className="text-fg-muted"
        >
          <Settings className="size-3.5" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form
          onSubmit={async (e) => {
            // Intercept the form submit so we can (1) broadcast `signed-out`
            // to peer tabs, (2) drain any pending preference writes while
            // the JWT is still valid, then (3) fire the server action. If
            // the auth cookie is cleared before the pref flush completes,
            // the write fails RLS silently and changes from the last
            // session are lost on re-login. Mirrored in mobile-nav-drawer
            // and command-palette logout paths.
            e.preventDefault();
            publishAuthEvent({ type: "signed-out", userId });
            await flushPreferences();
            await logout();
          }}
        >
          <DropdownMenuItem
            nativeButton
            render={
              <button type="submit" data-testid="account-menu-logout" />
            }
            className="text-fg-muted"
          >
            <LogOut className="size-3.5" />
            <span>Log out</span>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
