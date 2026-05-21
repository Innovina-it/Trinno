"use client";

import { useEffect } from "react";
import { useUserPreferences } from "@/lib/preferences/provider";

// Mirrors user preferences onto `<body data-*>` attributes globally so
// any page can read them, not just the settings/nav controls that own
// the toggle UI. Mounted once in the (app) layout.
//
// First paint is now SSR-handled in app/layout.tsx via a non-httpOnly
// cookie mirror (pref_sb, pref_density), which kills the hydration
// flicker. This component is responsible for SUBSEQUENT updates only —
// e.g. when the user toggles the sidebar or changes density at runtime.
export function PreferencesBodyMirror() {
  const { preferences } = useUserPreferences();
  const collapsed = preferences.sidebarCollapsed === true;
  const density = preferences.layoutDensity ?? "comfortable";

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (collapsed) {
      document.body.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.body.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-density", density);
  }, [density]);

  return null;
}
