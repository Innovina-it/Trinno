"use client";

import { useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useUserPreferences } from "@/lib/preferences/provider";

// Toggles `sidebarCollapsed` in user preferences and mirrors the state
// onto `<body data-sidebar-collapsed>` so any consumer (CSS, e2e tests)
// can read the persisted collapse state without re-querying preferences.
export function SidebarCollapseToggle() {
  const { preferences, setPreferences } = useUserPreferences();
  const collapsed = preferences.sidebarCollapsed === true;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (collapsed) {
      document.body.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.body.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed]);

  return (
    <button
      type="button"
      data-testid="sidebar-collapse-toggle"
      data-collapsed={collapsed ? "true" : undefined}
      aria-pressed={collapsed}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={() =>
        setPreferences((current) => ({
          sidebarCollapsed: !(current.sidebarCollapsed === true),
        }))
      }
      className="relative inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? (
        <PanelLeftOpen className="size-4" aria-hidden />
      ) : (
        <PanelLeftClose className="size-4" aria-hidden />
      )}
    </button>
  );
}
