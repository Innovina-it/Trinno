"use client";

import * as React from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { LogOut, Settings, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { logout } from "@/actions/auth";
import { useUserPreferences } from "@/lib/preferences/provider";

type DrawerLink = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  testId: string;
  chord?: string;
};

type MobileNavDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primary: DrawerLink[];
  secondary: DrawerLink[];
  email?: string;
  isActive: (href: string) => boolean;
  trigger?: React.ReactNode;
};

// Left-slide drawer for `<lg:` viewports. Full-height, opaque popover
// surface, drag handle along the right edge for dismiss. The drawer
// houses the primary + secondary nav (stacked, 44px hit targets), and
// the account footer with sign-out.
//
// Built on Base UI Dialog so focus-trap / aria-modal / escape-close
// come for free. We side-mount the popup left + slide-in-from-left
// rather than the default centered animation.
export function MobileNavDrawer({
  open,
  onOpenChange,
  primary,
  secondary,
  email,
  isActive,
  trigger,
}: MobileNavDrawerProps) {
  const { flushPreferences } = useUserPreferences();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogPrimitive.Trigger
          render={(props) => <React.Fragment {...props}>{trigger}</React.Fragment>}
        />
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 isolate z-50 bg-[color:rgb(0_0_0/0.65)] backdrop-blur-sm",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          data-slot="mobile-nav-drawer"
          className={cn(
            "fixed top-0 bottom-0 left-0 z-50 flex flex-col",
            "w-[min(85vw,320px)] h-dvh",
            "bg-[color:var(--popover)] text-fg",
            "border-r border-[color:var(--hairline-hi)]",
            "shadow-[40px_0_100px_-32px_rgb(0_0_0/0.6),1px_0_0_0_rgb(255_255_255/0.08)_inset]",
            "duration-250 ease-out will-change-transform",
            "data-open:animate-in data-open:slide-in-from-left-12 data-open:fade-in-0",
            "data-closed:animate-out data-closed:slide-out-to-left-12 data-closed:fade-out-0",
            "outline-none",
            "pt-[max(env(safe-area-inset-top),0px)] pb-[max(env(safe-area-inset-bottom),0px)] pl-[max(env(safe-area-inset-left),0px)]",
          )}
        >
          <header className="flex items-center justify-between gap-3 px-4 h-14 border-b border-hairline">
            <DialogPrimitive.Title className="font-sans text-sm font-semibold tracking-tight text-fg">
              Trinno
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className={cn(
                "shrink-0 inline-flex items-center justify-center rounded-full",
                "min-h-11 min-w-11",
                "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]",
                "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
              )}
              aria-label="Close navigation"
            >
              <XIcon className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>

          <nav
            aria-label="Primary"
            className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"
          >
            {primary.map((l) => {
              const active = isActive(l.href);
              return (
                <DialogPrimitive.Close
                  key={l.href}
                  nativeButton={false}
                  render={
                    <Link
                      href={l.href}
                      data-testid={l.testId}
                      data-active={active ? "true" : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-3 rounded-xl min-h-11 text-sm transition-colors",
                        active
                          ? "bg-[color:var(--surface-hi)] text-fg"
                          : "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg",
                      )}
                    />
                  }
                >
                  <l.Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">{l.label}</span>
                  {l.chord && (
                    <kbd className="mono-meta-sm text-fg-faint border border-hairline rounded px-1.5 py-0.5">
                      {l.chord}
                    </kbd>
                  )}
                </DialogPrimitive.Close>
              );
            })}

            {secondary.length > 0 && (
              <>
                <div className="px-3 pt-4 pb-1 mono-meta-sm text-fg-faint tracking-[0.14em]">
                  MORE
                </div>
                {secondary.map((s) => {
                  const active = isActive(s.href);
                  return (
                    <DialogPrimitive.Close
                      key={s.href}
                      nativeButton={false}
                      render={
                        <Link
                          href={s.href}
                          data-testid={s.testId}
                          data-active={active ? "true" : undefined}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 px-3 rounded-xl min-h-11 text-sm transition-colors",
                            active
                              ? "bg-[color:var(--surface-hi)] text-fg"
                              : "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg",
                          )}
                        />
                      }
                    >
                      <s.Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{s.label}</span>
                    </DialogPrimitive.Close>
                  );
                })}
              </>
            )}
          </nav>

          <footer className="border-t border-hairline px-3 py-2.5">
            {email && (
              <div className="px-2 pb-2">
                <p className="mono-meta-sm tracking-[0.14em] text-fg-faint">
                  SIGNED IN
                </p>
                <p
                  className="text-xs text-fg-muted truncate"
                  title={email}
                >
                  {email}
                </p>
              </div>
            )}
            <DialogPrimitive.Close
              nativeButton={false}
              render={
                <Link
                  href="/settings"
                  data-testid="mobile-nav-settings"
                  className={cn(
                    "w-full flex items-center gap-3 px-3 rounded-xl min-h-11 text-sm",
                    "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
                  )}
                />
              }
            >
              <Settings className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 text-left">Settings</span>
            </DialogPrimitive.Close>
            <form
              onSubmit={async (e) => {
                // See account-menu.tsx — drain pending pref writes before
                // the auth cookie is cleared. Without this, prefs changed
                // in the last 500ms window are lost on next sign-in.
                e.preventDefault();
                await flushPreferences();
                await logout();
              }}
            >
              <button
                type="submit"
                data-testid="mobile-nav-logout"
                className={cn(
                  "w-full flex items-center gap-3 px-3 rounded-xl min-h-11 text-sm",
                  "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
                )}
              >
                <LogOut className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">Log out</span>
              </button>
            </form>
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
