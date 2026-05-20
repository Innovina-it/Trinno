"use client";

import { Minimize2, Maximize2 } from "lucide-react";
import { useUserPreferences } from "@/lib/preferences/provider";

// Toggles `sidebarCollapsed` in user preferences. The pref drives a
// compact-navbar mode (hides primary nav labels via the body
// `data-sidebar-collapsed` attribute synced by PreferencesBodyMirror).
// Pref name is retained for backwards compatibility with stored rows
// and existing tests.
export function SidebarCollapseToggle() {
  const { preferences, setPreferences } = useUserPreferences();
  const collapsed = preferences.sidebarCollapsed === true;

  return (
    <button
      type="button"
      data-testid="sidebar-collapse-toggle"
      data-collapsed={collapsed ? "true" : undefined}
      aria-pressed={collapsed}
      aria-label={collapsed ? "Expand navigation labels" : "Compact navigation"}
      onClick={() =>
        setPreferences((current) => ({
          sidebarCollapsed: !(current.sidebarCollapsed === true),
        }))
      }
      className="relative inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
      title={collapsed ? "Expand navigation labels" : "Compact navigation"}
    >
      {collapsed ? (
        <Maximize2 className="size-4" aria-hidden />
      ) : (
        <Minimize2 className="size-4" aria-hidden />
      )}
    </button>
  );
}
